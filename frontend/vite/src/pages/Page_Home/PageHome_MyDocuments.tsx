import { Button, Empty, Skeleton, Typography, theme } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "@tanstack/react-router";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import { useQ_Me_PersonalOrganization } from "@/hooks/useQ_Me_PersonalOrganization";
import { useQ_Tables_Envelopes } from "@/hooks/useQ_Tables_Envelopes";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";

dayjs.extend(relativeTime);

// CG-048. The personal workspace, ON the main page rather than one click behind
// a card.
//
// The card this replaced was a menu item pointing at the only other thing the
// page could do. For a user with no organizations that made the landing page a
// list of two links, neither of which showed them anything they own.
//
// A PREVIEW, NOT THE PAGE. Five rows and a way through to the rest: the full
// list at `/me/documents` keeps the status tabs, the search and the sortable
// table, and duplicating those here would push Organizations off the fold for
// everyone who has both. The cut is `RECENT_LIMIT`, applied client-side because
// the query is already ordered by `created_at desc` and already cached under the
// key the full page uses — asking for five would mean a second cache entry and a
// second round trip for a list this size.
const RECENT_LIMIT = 5;

export const PageHome_MyDocuments = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();

    // READ-ONLY, and that is the point: rendering the main page must not create a
    // workspace. Provisioning happens in `/me`'s `beforeLoad`, which is where
    // both links below lead — so the first document a user makes is also the
    // moment their workspace appears. Until then this is an empty state, which is
    // the honest thing to show someone who owns nothing yet.
    const qPersonalOrganization = useQ_Me_PersonalOrganization();
    const organizationId = qPersonalOrganization.personalOrganizationId ?? "";

    // `enabled: !!organizationId` inside the hook means no request fires before
    // the workspace exists.
    const qEnvelopes = useQ_Tables_Envelopes({ organizationId, status: "all" });

    const recent = qEnvelopes.envelopes.slice(0, RECENT_LIMIT);
    const isLoading =
        qPersonalOrganization.query.isLoading || (!!organizationId && qEnvelopes.query.isLoading);
    const hasMore = qEnvelopes.envelopes.length > RECENT_LIMIT;

    return (
        <div style={{ marginBottom: 28 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: token.marginSM,
                    marginBottom: 12,
                }}
            >
                <Typography.Title level={4} style={{ margin: 0 }}>
                    My Documents
                </Typography.Title>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => navigate({ to: "/me/documents/new" })}
                >
                    {isMobile ? "New" : "New document"}
                </Button>
            </div>

            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                    overflow: "hidden",
                    background: token.colorBgContainer,
                }}
            >
                {isLoading ? (
                    <div style={{ padding: token.paddingMD }}>
                        <Skeleton active paragraph={{ rows: 3 }} title={false} />
                    </div>
                ) : recent.length === 0 ? (
                    <div style={{ padding: `${token.paddingLG}px ${token.paddingMD}px` }}>
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Upload, send and sign your own contracts — no organization needed"
                        />
                    </div>
                ) : (
                    recent.map((envelope, i) => (
                        <PageHome_DocumentRow
                            key={envelope.id}
                            envelope={envelope}
                            organizationId={organizationId}
                            isLast={i === recent.length - 1 && !hasMore}
                        />
                    ))
                )}

                {/* Only when there is something the five rows did not show. A
                    permanent "View all" under a list that already IS all of them
                    promises a fuller page than the one it opens. */}
                {hasMore && (
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            padding: `${token.paddingXS}px ${token.paddingMD}px`,
                        }}
                    >
                        <Link
                            to="/me/documents"
                            search={{ status: "all" }}
                            style={{ fontSize: token.fontSizeSM }}
                        >
                            View all {qEnvelopes.envelopes.length} →
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};

// A draft opens in the composer and everything else opens on its own page —
// the same rule the full list applies, routed through the same builder so the
// two cannot disagree about where a row goes.
const PageHome_DocumentRow = ({
    envelope,
    organizationId,
    isLast,
}: {
    envelope: ReturnType<typeof useQ_Tables_Envelopes>["envelopes"][number];
    organizationId: string;
    isLast: boolean;
}) => {
    const { token } = theme.useToken();
    const navigate = useNavigate();

    const target =
        envelope.status === "draft"
            ? Utils_Scope_Route.envelopeEdit("personal", organizationId, envelope.id)
            : Utils_Scope_Route.envelopeDetail("personal", organizationId, envelope.id);

    // `updated_at` rather than `created_at`: the column beside a status should
    // date that status, and a document sent in March and signed today reads as
    // stale if the row says March.
    const stamp = envelope.updated_at ?? envelope.created_at;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => navigate(target)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(target);
                }
            }}
            style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                padding: "10px 16px",
                cursor: "pointer",
                borderBottom: isLast ? "none" : `1px solid ${token.colorBorderSecondary}`,
                transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = token.colorPrimaryBg;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
            }}
        >
            <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                {envelope.title || "Untitled document"}
            </Typography.Text>
            <App_EnvelopeStatusTag status={envelope.status} />
            {stamp && (
                <Typography.Text
                    type="secondary"
                    style={{ fontSize: token.fontSizeSM, whiteSpace: "nowrap" }}
                >
                    {dayjs(stamp).fromNow()}
                </Typography.Text>
            )}
        </div>
    );
};
