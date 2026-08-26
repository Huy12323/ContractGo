import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    App,
    Button,
    Card,
    Empty,
    Input,
    Skeleton,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { App_PageToolbar } from "@/components/app-shell/App_PageToolbar";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import {
    const_EnvelopeStatusFilters,
    type Envelope_StatusFilter,
} from "@/components/envelopes/const_EnvelopeStatusOptions";
import {
    useQ_Tables_Envelopes,
    utils_Envelope_ExpiryState,
    utils_Envelope_SignedCount,
    utils_Envelope_WaitingOn,
    type Tables_Envelopes_Record,
} from "@/hooks/useQ_Tables_Envelopes";
import { useM_Envelope_DraftDelete } from "@/hooks/useM_Envelope_DraftDelete";
import { useQ_Tables_MyCapabilities } from "@/hooks/useQ_Tables_MyCapabilities";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";
import type { OrganizationScope } from "@/providers/organization/Provider_Organization";

// Everything this organization has sent for signature.
//
// An ANTD `Table`, not the canvas grid the HR app used: rows are tens, not tens
// of thousands, every column is text, and the list needs sorting and a row click
// rather than cell editing. `useGlideTheme` and the grid engine went with the
// employee grid in Phase B for exactly this reason.
//
// The status filter is a TYPED SEARCH PARAM rather than component state, so a
// sender can bookmark "everything awaiting signature" and so the back button
// returns to the tab they were on rather than to the default.

type Props = {
    organizationId: string;
    /** Which tab is showing. A required search param on both routes. */
    status: Envelope_StatusFilter;
    /** CG-048. Decides where a row click and the toolbar buttons go. */
    scope?: OrganizationScope;
};

// PROPS RATHER THAN `useParams`, as of CG-048. Two routes render this page —
// `/$organizationId/envelopes` and `/me/documents` — and the personal one has no
// `organizationId` in its path to read. Reading loosely (`{ strict: false }`)
// would make the id optional in a page that cannot function without it, trading a
// compile-time guarantee for a runtime `!`; each route wrapper passes it instead.
export const Page_Envelopes = ({ organizationId, status, scope = "org" }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();

    const { modal } = App.useApp();
    const [search, setSearch] = useState("");

    const mDraftDelete = useM_Envelope_DraftDelete();

    // CG-027. `signature_requests` SELECT has always admitted every member, so
    // this list is not new to them — what is new is that sending is a permission
    // rather than a tier, and a member who holds it needs the button a member
    // who doesn't must not see.
    const qCaps = useQ_Tables_MyCapabilities({ organizationId });
    const canSendDocuments = qCaps.canSendDocuments;

    // Everything the organization has sent. There was an entity narrowing on top
    // of this, but it never narrowed: the toolbar seeded it to "all" and the
    // selector that was the only way to change it had collapsed to a fixed chip.
    // CG-030 removed it along with the rest of the entity's client-side life.
    const qEnvelopes = useQ_Tables_Envelopes({ organizationId, status });

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return qEnvelopes.envelopes;
        return qEnvelopes.envelopes.filter(
            (envelope) =>
                envelope.title.toLowerCase().includes(q) ||
                envelope.signature_request_signers.some(
                    (signer) =>
                        signer.signer_name.toLowerCase().includes(q) ||
                        signer.signer_email.toLowerCase().includes(q)
                )
        );
    }, [qEnvelopes.envelopes, search]);

    // Confirmed, unlike archiving a template: a draft is the only envelope the
    // product ever really deletes. Everything else is voided or expires, and the
    // row plus its audit chain survive — so this is the one action here with no
    // undo, and it says what is being destroyed by name.
    const handleDeleteDraft = useCallback(
        (envelope: Tables_Envelopes_Record) =>
            modal.confirm({
                title: "Delete this draft?",
                content: `"${envelope.title}" has not been sent to anyone. Deleting it cannot be undone.`,
                okText: "Delete draft",
                okButtonProps: { danger: true },
                onOk: () => mDraftDelete.mutation.mutateAsync({ envelopeId: envelope.id }),
            }),
        [modal, mDraftDelete.mutation]
    );

    // Where a row click goes. Extracted because the table's `onRow` and the mobile
    // card list both need it, and the draft-vs-sent branch below is a real product
    // rule rather than a detail either surface should be re-deriving.
    const openEnvelope = useCallback(
        (envelope: Tables_Envelopes_Record) =>
            // A draft opens in the COMPOSER, not the detail page. The detail page
            // reads a `template_snapshot` and a signer list to answer "who is this
            // waiting on", and a draft is waiting on the sender — the useful thing
            // to show them is the form they left half-finished.
            envelope.status === "draft"
                ? navigate(Utils_Scope_Route.envelopeEdit(scope, organizationId, envelope.id))
                : navigate(Utils_Scope_Route.envelopeDetail(scope, organizationId, envelope.id)),
        [navigate, organizationId, scope]
    );

    // Shared by the table's `locale.emptyText` and the card list, so the two
    // surfaces cannot end up explaining an empty tab differently.
    const emptyDescription = search
        ? `Nothing matches "${search}"`
        : status === "all"
          ? "Nothing sent for signature yet"
          : status === "draft"
            ? "No drafts. Anything you save while composing waits here."
            : "No documents in this state";

    const columns: ColumnsType<Tables_Envelopes_Record> = useMemo(
        () => [
            {
                title: "Document",
                dataIndex: "title",
                key: "title",
                sorter: (a, b) => a.title.localeCompare(b.title),
                render: (title: string) => <Typography.Text strong>{title}</Typography.Text>,
            },
            {
                title: "Status",
                dataIndex: "status",
                key: "status",
                width: 190,
                render: (_, envelope) => <App_EnvelopeStatusTag status={envelope.status} />,
            },
            {
                title: "Recipients",
                key: "recipients",
                width: 260,
                render: (_, envelope) => {
                    const signers = envelope.signature_request_signers;
                    const names = signers.map((signer) => signer.signer_name).join(", ");
                    return (
                        <Tooltip title={names}>
                            <Typography.Text ellipsis style={{ maxWidth: 240, display: "block" }}>
                                {names || "—"}
                            </Typography.Text>
                        </Tooltip>
                    );
                },
            },
            {
                title: "Progress",
                key: "progress",
                width: 200,
                render: (_, envelope) => {
                    const signers = envelope.signature_request_signers;
                    const signed = utils_Envelope_SignedCount(signers);
                    const waiting = utils_Envelope_WaitingOn(envelope);
                    return (
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                {signed} of {signers.length} signed
                            </Typography.Text>
                            {waiting.length > 0 && (
                                <Typography.Text
                                    type="secondary"
                                    ellipsis
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    waiting on {waiting.join(", ")}
                                </Typography.Text>
                            )}
                        </div>
                    );
                },
            },
            {
                // Sorted by the deadline itself rather than by the rendered
                // label: "in 2 days" and "in 10 days" compare as strings in the
                // wrong order, and a column whose sort disagrees with its own
                // contents is worse than no sort.
                title: "Deadline",
                key: "expires_at",
                width: 150,
                // Documents with no deadline sort last in both directions — they
                // are the ones nothing is urgent about.
                sorter: (a, b) => (a.expires_at ?? "9999").localeCompare(b.expires_at ?? "9999"),
                render: (_, envelope) => {
                    const expiry = utils_Envelope_ExpiryState(envelope);
                    if (expiry.kind === "none") {
                        return <Typography.Text type="secondary">—</Typography.Text>;
                    }
                    // The cron job runs hourly, so a document can sit past its
                    // deadline for up to an hour before the status catches up.
                    // Saying "overdue" is more honest than a countdown that has
                    // already run out.
                    if (expiry.kind === "passed") {
                        return <Tag color="warning">Overdue</Tag>;
                    }
                    return (
                        <Tooltip title={new Date(expiry.at).toLocaleString()}>
                            <Tag color={expiry.kind === "soon" ? "warning" : "default"}>
                                {expiry.days === 1 ? "in 1 day" : `in ${expiry.days} days`}
                            </Tag>
                        </Tooltip>
                    );
                },
            },
            {
                title: "Sent",
                dataIndex: "sent_at",
                key: "sent_at",
                width: 160,
                // Sorted on the raw ISO string, which for UTC timestamps sorts
                // identically to the instants and avoids constructing a Date per
                // comparison. Nulls (drafts) sort last.
                sorter: (a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""),
                render: (sentAt: string | null) =>
                    sentAt ? (
                        new Date(sentAt).toLocaleDateString()
                    ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                    ),
            },
            {
                // Only drafts get an action, so the column is empty on every other
                // tab rather than being conditionally added — a column that appears
                // and disappears shifts every other column's width as the sender
                // moves between tabs.
                title: "",
                key: "actions",
                width: 56,
                render: (_, envelope) =>
                    // CG-027: deleting a draft is a `send_documents` write —
                    // `senders_can_delete_signature_requests` is what refuses it —
                    // so a member without the permission gets the column but no icon.
                    envelope.status === "draft" && canSendDocuments ? (
                        <Tooltip title="Delete this draft">
                            <Button
                                type="text"
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                // The row's own click opens the draft; without this
                                // the delete would also navigate into the thing it
                                // just removed.
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteDraft(envelope);
                                }}
                            />
                        </Tooltip>
                    ) : null,
            },
        ],
        [token.fontSizeSM, handleDeleteDraft, canSendDocuments]
    );

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <App_PageToolbar
                actions={
                    <>
                        <Input
                            placeholder="Search title or recipient"
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            allowClear
                            // On mobile the actions are their own toolbar row, so
                            // the search claims it and the button sits beside it.
                            style={{
                                width: isMobile ? undefined : 280,
                                flex: isMobile ? 1 : undefined,
                            }}
                        />
                        {qCaps.canSendDocuments && (
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={() =>
                                    navigate({
                                        ...Utils_Scope_Route.envelopeNew(scope, organizationId),
                                        search: {},
                                    })
                                }
                            >
                                {isMobile ? "Send" : "Send document"}
                            </Button>
                        )}
                    </>
                }
            />

            <div style={{ padding: `0 ${token.paddingMD}px`, flexShrink: 0 }}>
                <Tabs
                    activeKey={status}
                    items={const_EnvelopeStatusFilters.map((filter) => ({
                        key: filter.value,
                        label: filter.label,
                    }))}
                    onChange={(key) =>
                        navigate({
                            ...Utils_Scope_Route.envelopes(scope, organizationId),
                            search: { status: key as typeof status },
                        })
                    }
                />
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                }}
            >
                {/* CARDS ON A PHONE, NOT A SQUASHED TABLE. The columns below add up
                    to ~960px of fixed widths; at 390px ANTD keeps the table that
                    wide and the pane scrolls sideways, so reading one document
                    means panning across six columns. The card shows the same six
                    facts stacked, which is what a phone is shaped for. */}
                {isMobile ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginSM }}>
                        {qEnvelopes.query.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}

                        {!qEnvelopes.query.isLoading &&
                            filtered.map((envelope) => {
                                const signers = envelope.signature_request_signers;
                                const signed = utils_Envelope_SignedCount(signers);
                                const waiting = utils_Envelope_WaitingOn(envelope);
                                const expiry = utils_Envelope_ExpiryState(envelope);
                                return (
                                    <Card
                                        key={envelope.id}
                                        size="small"
                                        hoverable
                                        onClick={() => openEnvelope(envelope)}
                                        styles={{
                                            body: {
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: token.marginXXS,
                                            },
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "flex-start",
                                                gap: token.marginXS,
                                            }}
                                        >
                                            <Typography.Text strong style={{ flex: 1 }}>
                                                {envelope.title}
                                            </Typography.Text>
                                            <App_EnvelopeStatusTag status={envelope.status} />
                                        </div>

                                        <Typography.Text
                                            type="secondary"
                                            ellipsis
                                            style={{ fontSize: token.fontSizeSM }}
                                        >
                                            {signers.map((s) => s.signer_name).join(", ") || "—"}
                                        </Typography.Text>

                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                flexWrap: "wrap",
                                                gap: token.marginXS,
                                                fontSize: token.fontSizeSM,
                                            }}
                                        >
                                            <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                                                {signed} of {signers.length} signed
                                            </Typography.Text>
                                            {expiry.kind === "passed" && (
                                                <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                                                    Overdue
                                                </Tag>
                                            )}
                                            {expiry.kind === "soon" && (
                                                <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                                                    {expiry.days === 1
                                                        ? "in 1 day"
                                                        : `in ${expiry.days} days`}
                                                </Tag>
                                            )}
                                            {envelope.sent_at && (
                                                <Typography.Text
                                                    type="secondary"
                                                    style={{ fontSize: token.fontSizeSM }}
                                                >
                                                    sent{" "}
                                                    {new Date(
                                                        envelope.sent_at
                                                    ).toLocaleDateString()}
                                                </Typography.Text>
                                            )}
                                            {envelope.status === "draft" && canSendDocuments && (
                                                <Button
                                                    type="text"
                                                    danger
                                                    size="small"
                                                    style={{ marginLeft: "auto" }}
                                                    icon={<DeleteOutlined />}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleDeleteDraft(envelope);
                                                    }}
                                                />
                                            )}
                                        </div>

                                        {waiting.length > 0 && (
                                            <Typography.Text
                                                type="secondary"
                                                ellipsis
                                                style={{ fontSize: token.fontSizeSM }}
                                            >
                                                waiting on {waiting.join(", ")}
                                            </Typography.Text>
                                        )}
                                    </Card>
                                );
                            })}

                        {!qEnvelopes.query.isLoading && filtered.length === 0 && (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={emptyDescription}
                            />
                        )}
                    </div>
                ) : (
                    <Table
                        rowKey="id"
                        size="middle"
                        loading={qEnvelopes.query.isLoading}
                        columns={columns}
                        dataSource={filtered}
                        pagination={{ pageSize: 25, hideOnSinglePage: true }}
                        // The columns declare ~960px of fixed widths. Without this
                        // ANTD squeezes them into whatever the pane is, so on a
                        // tablet the titles became unreadable rather than scrollable.
                        scroll={{ x: "max-content" }}
                        onRow={(envelope) => ({
                            style: { cursor: "pointer" },
                            onClick: () => openEnvelope(envelope),
                        })}
                        locale={{
                            emptyText: (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={emptyDescription}
                                />
                            ),
                        }}
                    />
                )}
            </div>
        </div>
    );
};
