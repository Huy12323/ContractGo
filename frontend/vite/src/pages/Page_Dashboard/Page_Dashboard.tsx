import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Alert, Button, Card, Empty, Skeleton, Tag, Typography, theme } from "antd";
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    EditOutlined,
    PlusOutlined,
    RightOutlined,
} from "@ant-design/icons";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import {
    useQ_Tables_Envelopes,
    utils_Envelope_ExpiryState,
    utils_Envelope_SignedCount,
    utils_Envelope_WaitingOn,
    type Tables_Envelopes_Record,
} from "@/hooks/useQ_Tables_Envelopes";
import type { Envelope_StatusFilter } from "@/components/envelopes/const_EnvelopeStatusOptions";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    utils_Dashboard_FormatHours,
    utils_Dashboard_Kpis,
} from "@/pages/Page_Dashboard/utils_Dashboard_Kpis";

// The organization landing page. Replaces the "Dashboard coming soon" stub.
//
// It answers one question — what needs attention — and then gets out of the way.
//
// CG-043 added the reporting the previous version of this comment deferred, and
// put it BELOW that answer rather than in front of it. The ordering is the whole
// point: a sender opening the app wants the documents that are stuck, not a
// completion rate. Throughput, time-to-sign and completion rate are what someone
// asks for once a week, so they sit under the fold of the thing asked for daily —
// which now means literally under the waiting list, rather than above it.
//
// One query, filtered client-side into the tiles. The alternative — a count query
// per tile — would be four round trips to render numbers that are all derivable
// from the rows the "needs attention" list already needs.

/** How many rows the "waiting the longest" list shows before deferring to the list page. */
const WAITING_LIMIT = 8;

export const Page_Dashboard = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const { organizationId } = useParams({ from: "/_protected/$organizationId/" });

    const qEnvelopes = useQ_Tables_Envelopes({ organizationId, status: "all" });

    const stats = useMemo(() => {
        const all = qEnvelopes.envelopes;
        return {
            drafts: all.filter((e) => e.status === "draft").length,
            inProgress: all.filter((e) => e.status === "in_progress").length,
            completed: all.filter((e) => e.status === "completed").length,
            attention: all.filter((e) => e.status === "declined").length,
        };
    }, [qEnvelopes.envelopes]);

    // Derived from the SAME rows as the tiles above — no second query, matching
    // this page's one-query design.
    const kpis = useMemo(() => utils_Dashboard_Kpis(qEnvelopes.envelopes), [qEnvelopes.envelopes]);

    // Awaiting signature, oldest first — the ones that have been waiting longest
    // are the ones most likely to need chasing, which is the opposite of the
    // list page's newest-first default.
    const inProgress = useMemo(
        () =>
            qEnvelopes.envelopes
                .filter((envelope) => envelope.status === "in_progress")
                .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? "")),
        [qEnvelopes.envelopes]
    );

    const waiting = useMemo(() => inProgress.slice(0, WAITING_LIMIT), [inProgress]);

    // The deadline banner. `utils_Envelope_ExpiryState` already existed and the
    // list page already showed it per row; the dashboard was the one surface
    // claiming to say "what needs attention" while staying silent about documents
    // about to lapse. Counted over ALL in-flight documents rather than the eight
    // rendered below, because the point is to surface what is off-screen.
    const lapsing = useMemo(() => {
        let passed = 0;
        let soon = 0;
        for (const envelope of inProgress) {
            const state = utils_Envelope_ExpiryState(envelope);
            if (state.kind === "passed") passed += 1;
            else if (state.kind === "soon") soon += 1;
        }
        return { passed, soon };
    }, [inProgress]);

    const goToList = (status: Envelope_StatusFilter) =>
        navigate({
            to: "/$organizationId/envelopes",
            params: { organizationId },
            search: { status },
        });

    // Page chrome shared by the loading, error and loaded states, so a failure
    // lands in the same column the content would have.
    const shell = (children: React.ReactNode) => (
        <div
            style={{
                height: "100%",
                overflow: "auto",
                padding: isMobile ? token.paddingSM : token.paddingLG,
            }}
        >
            <div style={{ maxWidth: 960, margin: "0 auto" }}>{children}</div>
        </div>
    );

    // A SKELETON IN THE SHAPE OF THE PAGE, not a centred spinner. The spinner sat
    // in a container of a different height to the content that replaced it, so
    // every load ended in a jump; this reserves the tiles and the list where they
    // will actually land. `Page_Envelopes` already loads this way.
    if (qEnvelopes.query.isLoading) {
        return shell(
            <>
                <Skeleton.Input active style={{ width: 160, marginBottom: token.marginLG }} />
                <div style={utils_Dashboard_TileGrid(token.marginMD)}>
                    {[0, 1, 2, 3].map((index) => (
                        <Card key={index} styles={{ body: { padding: token.paddingMD } }}>
                            <Skeleton active paragraph={false} title={{ width: "70%" }} />
                        </Card>
                    ))}
                </div>
                <Card style={{ marginTop: token.marginLG }}>
                    <Skeleton active paragraph={{ rows: 4 }} />
                </Card>
            </>
        );
    }

    // A failed query used to render as a dashboard full of zeroes — indistinguishable
    // from a brand new organization, and the more alarming of the two readings is
    // the wrong one.
    if (qEnvelopes.query.isError) {
        return shell(
            <Alert
                type="error"
                showIcon
                message="Couldn't load your documents"
                description="Something went wrong reaching the server. Nothing has been lost."
                action={
                    <Button size="small" onClick={() => void qEnvelopes.query.refetch()}>
                        Try again
                    </Button>
                }
            />
        );
    }

    return shell(
        <>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: token.marginSM,
                    marginBottom: token.marginLG,
                }}
            >
                <Typography.Title level={4} style={{ margin: 0 }}>
                    Overview
                </Typography.Title>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() =>
                        navigate({
                            to: "/$organizationId/envelopes/new",
                            params: { organizationId },
                            search: {},
                        })
                    }
                >
                    {isMobile ? "Send" : "Send document"}
                </Button>
            </div>

            {(lapsing.passed > 0 || lapsing.soon > 0) && (
                <Alert
                    type={lapsing.passed > 0 ? "error" : "warning"}
                    showIcon
                    style={{ marginBottom: token.marginLG }}
                    message={utils_Dashboard_LapsingMessage(lapsing)}
                    action={
                        <Button size="small" onClick={() => goToList("in_progress")}>
                            Review
                        </Button>
                    }
                />
            )}

            <div style={utils_Dashboard_TileGrid(token.marginMD)}>
                <StatTile
                    label="Drafts"
                    value={stats.drafts}
                    icon={<EditOutlined />}
                    tone={token.colorTextSecondary}
                    chipBg={token.colorFillTertiary}
                    onClick={() => goToList("draft")}
                />
                <StatTile
                    label="Awaiting signature"
                    value={stats.inProgress}
                    icon={<ClockCircleOutlined />}
                    tone={token.colorPrimary}
                    chipBg={token.colorPrimaryBg}
                    onClick={() => goToList("in_progress")}
                />
                <StatTile
                    label="Completed"
                    value={stats.completed}
                    icon={<CheckCircleOutlined />}
                    tone={token.colorSuccess}
                    chipBg={token.colorSuccessBg}
                    onClick={() => goToList("completed")}
                />
                <StatTile
                    label="Declined"
                    value={stats.attention}
                    icon={<CloseCircleOutlined />}
                    tone={token.colorError}
                    chipBg={token.colorErrorBg}
                    emphasise={stats.attention > 0}
                    onClick={() => goToList("declined")}
                />
            </div>

            <div style={{ marginTop: token.marginLG }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: token.marginSM,
                        marginBottom: token.marginSM,
                    }}
                >
                    <Typography.Text strong>Waiting the longest</Typography.Text>
                    {/* Only once the list is actually truncated. A "view all" beside
                        a complete list is a link back to the same information. */}
                    {inProgress.length > WAITING_LIMIT && (
                        <Button type="link" size="small" onClick={() => goToList("in_progress")}>
                            View all {inProgress.length}
                        </Button>
                    )}
                </div>

                {waiting.length === 0 ? (
                    <Card styles={{ body: { padding: token.paddingLG } }}>
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Nothing is waiting on a signature"
                        />
                    </Card>
                ) : (
                    <div
                        style={{
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusLG,
                            background: token.colorBgContainer,
                            overflow: "hidden",
                        }}
                    >
                        {waiting.map((envelope, index) => (
                            <WaitingRow
                                key={envelope.id}
                                envelope={envelope}
                                isLast={index === waiting.length - 1}
                                onOpen={() =>
                                    navigate({
                                        to: "/$organizationId/envelopes/$envelopeId",
                                        params: { organizationId, envelopeId: envelope.id },
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Reporting, deliberately quieter than the tiles above: smaller type,
                no click targets, and it disappears entirely until there is enough
                history for the numbers to mean anything. A completion rate computed
                from two documents is arithmetically true and practically
                misleading, and somebody would quote it. */}
            {kpis.hasEnoughData ? (
                <div style={{ marginTop: token.marginLG }}>
                    <Typography.Text strong>How signing is going</Typography.Text>
                    <div
                        style={{
                            ...utils_Dashboard_TileGrid(token.marginMD),
                            marginTop: token.marginSM,
                        }}
                    >
                        <MetricTile
                            label="Completion rate"
                            value={kpis.completionRate === null ? "—" : `${kpis.completionRate}%`}
                            hint={`of ${kpis.finished} finished`}
                        />
                        <MetricTile
                            label="Typical time to sign"
                            value={utils_Dashboard_FormatHours(kpis.medianHoursToComplete)}
                            hint="median, send to complete"
                        />
                        <MetricTile
                            label="Ended without signature"
                            value={String(kpis.declined + kpis.expired + kpis.voided)}
                            hint="declined, expired or voided"
                        />
                        <MetricTile
                            label="Completed this month"
                            value={String(
                                kpis.byMonth.find(
                                    (m) => m.month === new Date().toISOString().slice(0, 7)
                                )?.completed ?? 0
                            )}
                            hint={`${kpis.completed} all time`}
                        />
                    </div>
                </div>
            ) : (
                kpis.finished > 0 && (
                    <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, marginTop: token.marginLG }}
                    >
                        Completion rates and timings appear once a few more documents have finished.
                    </Typography.Paragraph>
                )
            )}
        </>
    );
};

/** One grid definition for both tile rows, so the two cannot drift out of alignment. */
const utils_Dashboard_TileGrid = (gap: number): React.CSSProperties => ({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap,
});

/** The deadline banner's sentence. Built here rather than in JSX so the two
 *  counts are joined — and pluralised — in one place. */
const utils_Dashboard_LapsingMessage = ({
    passed,
    soon,
}: {
    passed: number;
    soon: number;
}): string => {
    const parts: string[] = [];
    if (passed > 0)
        parts.push(
            `${passed} ${passed === 1 ? "document is" : "documents are"} past their deadline`
        );
    if (soon > 0) parts.push(`${soon} ${soon === 1 ? "is" : "are"} expiring soon`);
    return parts.join(" · ");
};

/** How long an in-flight document has been out, in the same vocabulary the KPI
 *  tiles use for durations. The section is titled "waiting the longest" and used
 *  to show a send DATE, which left the reader doing the subtraction. */
const utils_Dashboard_WaitingFor = (sentAt: string | null): string | null => {
    if (!sentAt) return null;
    const ms = Date.now() - Date.parse(sentAt);
    if (!Number.isFinite(ms) || ms < 0) return null;
    return utils_Dashboard_FormatHours(ms / 3_600_000);
};

const WaitingRow = ({
    envelope,
    isLast,
    onOpen,
}: {
    envelope: Tables_Envelopes_Record;
    isLast: boolean;
    onOpen: () => void;
}) => {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);

    const signers = envelope.signature_request_signers;
    const signed = utils_Envelope_SignedCount(signers);
    const waitingOn = utils_Envelope_WaitingOn(envelope);
    const expiry = utils_Envelope_ExpiryState(envelope);
    const waitingFor = utils_Dashboard_WaitingFor(envelope.sent_at);

    return (
        // A ROW IS A LINK, so it behaves like one: focusable, Enter and Space
        // activate it, and it responds to the pointer. It was a bare `div` with an
        // `onClick` — reachable by mouse only, and with nothing on screen saying it
        // was reachable at all until you happened to hover it.
        <div
            role="link"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen();
                }
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                padding: `${token.paddingSM}px ${token.paddingMD}px`,
                cursor: "pointer",
                background: hovered ? token.controlItemBgHover : undefined,
                transition: `background ${token.motionDurationMid}`,
                borderBottom: isLast ? undefined : `1px solid ${token.colorBorderSecondary}`,
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong ellipsis style={{ display: "block" }}>
                    {envelope.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {signed} of {signers.length} signed
                    {waitingOn.length > 0 && ` · waiting on ${waitingOn.join(", ")}`}
                    {waitingFor && ` · out for ${waitingFor}`}
                </Typography.Text>
            </div>

            {/* The deadline outranks the status here. Every row in this list has the
                same status — that is what the filter selected — so the tag worth the
                space is the one that isn't constant down the column. */}
            {expiry.kind === "passed" ? (
                <Tag color="error">Overdue</Tag>
            ) : expiry.kind === "soon" ? (
                <Tag color="warning">
                    {expiry.days === 1 ? "1 day left" : `${expiry.days} days left`}
                </Tag>
            ) : (
                <App_EnvelopeStatusTag status={envelope.status} />
            )}

            <RightOutlined
                aria-hidden
                style={{ color: token.colorTextQuaternary, fontSize: token.fontSizeSM }}
            />
        </div>
    );
};

/**
 * A reporting figure. Deliberately NOT a `StatTile`: those are clickable and
 * navigate to a filtered list, and every one of these would need a destination
 * that does not exist ("show me the documents contributing to a median"). Giving
 * them the same affordance would promise a drill-down that goes nowhere.
 */
const MetricTile = ({ label, value, hint }: { label: string; value: string; hint: string }) => {
    const { token } = theme.useToken();
    return (
        <Card styles={{ body: { padding: token.paddingMD } }}>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {label}
            </Typography.Text>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{value}</div>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {hint}
            </Typography.Text>
        </Card>
    );
};

const StatTile = ({
    label,
    value,
    icon,
    tone,
    chipBg,
    onClick,
    emphasise = false,
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    /** The status colour. Carried by the icon chip, not the numeral — see below. */
    tone: string;
    chipBg: string;
    onClick: () => void;
    emphasise?: boolean;
}) => {
    const { token } = theme.useToken();
    return (
        <Card
            hoverable
            onClick={onClick}
            styles={{ body: { padding: token.paddingMD } }}
            style={{ cursor: "pointer" }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: token.marginSM }}>
                {/* The colour lives in a tinted chip rather than in the numeral.
                    Four coloured 26px numbers side by side read as four alarms; the
                    chip keeps each tile identifiable at a glance while leaving the
                    figures one scannable column. `emphasise` is the one exception —
                    a Declined count above zero IS the alarm. Both colours come from
                    theme tokens rather than a hand-mixed alpha, so the tiles follow
                    a theme switch. */}
                <span
                    aria-hidden
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 32,
                        height: 32,
                        flex: "none",
                        borderRadius: token.borderRadiusLG,
                        background: chipBg,
                        color: tone,
                        fontSize: 16,
                    }}
                >
                    {icon}
                </span>
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 26,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            color: emphasise ? token.colorError : token.colorText,
                        }}
                    >
                        {value}
                    </div>
                    <Typography.Text
                        type="secondary"
                        ellipsis
                        style={{ fontSize: token.fontSizeSM, display: "block" }}
                    >
                        {label}
                    </Typography.Text>
                </div>
            </div>
        </Card>
    );
};
