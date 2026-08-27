import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    Alert,
    App,
    Button,
    Descriptions,
    Input,
    Modal,
    Result,
    Spin,
    Tabs,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import {
    ArrowLeftOutlined,
    AuditOutlined,
    BellOutlined,
    DownloadOutlined,
    RedoOutlined,
    StopOutlined,
} from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { Utils_Modal_Responsive } from "@/utils/Utils_Modal_Responsive";
import { App_EnvelopeStatusTag } from "@/components/envelopes/App_EnvelopeStatusTag";
import { utils_Envelope_SignerAuthOption } from "@/components/envelopes/const_EnvelopeSignerAuthOptions";
import { App_EnvelopeSignerList } from "@/components/envelopes/App_EnvelopeSignerList";
import { App_EnvelopeTimeline } from "@/components/envelopes/App_EnvelopeTimeline";
import { App_EnvelopeDocumentViewer } from "@/components/envelopes/App_EnvelopeDocumentViewer";
import { App_EnvelopeRequestChangesModal } from "@/components/envelopes/App_EnvelopeRequestChangesModal";
import { useQ_Tables_Envelope, type Tables_Envelope_Signer } from "@/hooks/useQ_Tables_Envelope";
import { utils_Envelope_ExpiryState } from "@/hooks/useQ_Tables_Envelopes";
import { useM_Envelope_Void } from "@/hooks/useM_Envelope_Void";
import { useM_Envelope_Resend } from "@/hooks/useM_Envelope_Resend";
import { useM_Envelope_Remind } from "@/hooks/useM_Envelope_Remind";
import { useM_Envelope_RequestChanges } from "@/hooks/useM_Envelope_RequestChanges";
import { useM_Envelope_DownloadSigned } from "@/hooks/useM_Envelope_DownloadSigned";
import { useM_Envelope_CertificateOpen } from "@/hooks/useM_Envelope_CertificateOpen";
import { useQ_Tables_MyCapabilities } from "@/hooks/useQ_Tables_MyCapabilities";
import {
    utils_Templates_MigrateLayout,
    utils_Templates_MigrateSignerRoles,
} from "@/components/templates/utils_Templates_MigrateLayout";
import type { Template_Snapshot } from "@/types/template.types";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";
import type { OrganizationScope } from "@/providers/organization/Provider_Organization";

// One document: who has it, what happened to it, and what the sender can do.
//
// Everything shown here is read from the ENVELOPE, never from the template it
// came from. The template may have been edited or hard-deleted since it was sent
// — `template_snapshot` is the copy that makes the request self-sufficient
// (AHR-1487/1490/1954), and reading roles from anywhere else would show the
// wrong parties for an old document.
//
// The document-level actions live in the header: remind, resend, void, download.
// Request changes deliberately does NOT — it acts on one named party rather than
// on the document, so it sits beside that party in the recipient list. It is also
// the only action here that moves the routing backwards, which is why the modal
// spells out all three of its consequences before confirming (CG-014).
//
// v1.0 had no sender-side review at all: the HR ancestor's approve/reject had no
// state machine in this schema and no audit events. CG-011 added the
// `changes_requested` status and the `sender_requested_changes` /
// `capture_superseded` event types, and CG-014 added the transition itself.

type Props = {
    organizationId: string;
    envelopeId: string;
    /** CG-048. Decides where "back to documents" goes. */
    scope?: OrganizationScope;
};

// PROPS RATHER THAN `useParams`, as of CG-048 — see the note on `Page_Envelopes`.
// Two routes render this page and only one of them names an organization in its
// path, so both hand it its identity instead.
export const Page_EnvelopeDetail = ({ organizationId, envelopeId, scope = "org" }: Props) => {
    const { token } = theme.useToken();
    // `lg` (992) is where a side-by-side split stops paying for itself: below it
    // the document pane is narrower than a readable page. Defaults only — nothing
    // here is a lock, the panes simply stack.
    const { isDesktop: isWide, isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();
    const { modal } = App.useApp();
    const [voidReason, setVoidReason] = useState("");
    const [voidOpen, setVoidOpen] = useState(false);
    // The signer whose turn is being sent back. Held as the whole row rather than
    // an id because the modal names them, and re-deriving it from `signers` would
    // make the modal's copy depend on a list that the mutation's own invalidation
    // is about to change underneath it.
    const [changesTarget, setChangesTarget] = useState<Tables_Envelope_Signer | null>(null);

    const qEnvelope = useQ_Tables_Envelope({ envelopeId });
    const qCaps = useQ_Tables_MyCapabilities({ organizationId });
    const mVoid = useM_Envelope_Void();
    const mResend = useM_Envelope_Resend();
    const mRemind = useM_Envelope_Remind();
    const mRequestChanges = useM_Envelope_RequestChanges();
    const mDownload = useM_Envelope_DownloadSigned();
    const mCertificate = useM_Envelope_CertificateOpen();

    const envelope = qEnvelope.envelope;

    const roles = useMemo(() => {
        const snapshot = envelope?.template_snapshot as Template_Snapshot | null;
        return utils_Templates_MigrateSignerRoles(snapshot?.signer_roles);
    }, [envelope?.template_snapshot]);

    // The field boxes to draw over the SOURCE pdf. Read from the snapshot rather
    // than the live template for the same reason everything else on this page is:
    // the snapshot is what the parties were actually asked to sign. A draft has no
    // snapshot yet, which yields an empty layout and no overlay.
    const layout = useMemo(() => {
        const snapshot = envelope?.template_snapshot as Template_Snapshot | null;
        if (!snapshot || snapshot.type !== "pdf") return [];
        return utils_Templates_MigrateLayout(snapshot.layout);
    }, [envelope?.template_snapshot]);

    // Sender-prefilled values first, then whatever each signer entered on top —
    // the same precedence `signing_session_open` applies when it builds a session.
    const fieldValues = useMemo(() => {
        const merged: Record<string, unknown> = {
            ...((envelope?.prefilled_values as Record<string, unknown> | null) ?? {}),
        };
        for (const signer of envelope?.signature_request_signers ?? [])
            Object.assign(merged, (signer.field_values as Record<string, unknown> | null) ?? {});
        return merged;
    }, [envelope?.prefilled_values, envelope?.signature_request_signers]);

    const signers = useMemo(
        () =>
            [...(envelope?.signature_request_signers ?? [])].sort(
                (a, b) => a.signer_order - b.signer_order
            ),
        [envelope?.signature_request_signers]
    );

    if (qEnvelope.query.isLoading) {
        return (
            <div style={{ display: "flex", justifyContent: "center", padding: token.paddingXL }}>
                <Spin size="large" />
            </div>
        );
    }

    if (!envelope) {
        return (
            <Result
                status="404"
                title="Document not found"
                subTitle="It may have been removed, or it belongs to another organization."
                extra={
                    <Button
                        type="primary"
                        onClick={() =>
                            navigate({
                                ...Utils_Scope_Route.envelopes(scope, organizationId),
                                search: { status: "all" },
                            })
                        }
                    >
                        Back to documents
                    </Button>
                }
            />
        );
    }

    const isInFlight = envelope.status === "in_progress";
    const isCompleted = envelope.status === "completed";

    // CG-027. Every action that CHANGES this document — remind, resend, void,
    // request changes — is a `send_documents` write. Everything else on the page
    // is reading: the viewer, the audit trail, the hashes, and the signed PDF
    // download, all of which any member has always been able to reach through
    // RLS and now finally can. `canAct` folds in `isInFlight` because all four
    // controls were already conditional on it.
    const canAct = isInFlight && qCaps.canSendDocuments;
    const expiry = utils_Envelope_ExpiryState(envelope);
    const reminderDays = (envelope.reminder_days ?? []) as number[];
    // Defaults to `account` for every envelope sent before CG-031, which is what
    // those documents actually required.
    const signerAuthOption = utils_Envelope_SignerAuthOption(envelope.signer_auth);
    // CG-032: the Tag above describes the envelope's DEFAULT, which since that
    // migration is not necessarily what every recipient owes. Without this
    // qualifier the summary would state one requirement for a document that has
    // two — and a sender rescuing a stuck signer would be told the wrong rescue.
    const hasAuthOverride = signers.some((signer) => !!signer.auth_method);

    const handleVoid = async () => {
        await mVoid.mutation.mutateAsync({
            organization_id: organizationId,
            envelope_id: envelopeId,
            reason: voidReason.trim() || undefined,
        });
        setVoidOpen(false);
        setVoidReason("");
    };

    // Two buttons, deliberately, and the copy is what keeps them apart. A
    // reminder mails a nudge and leaves the recipient's existing link alone; a
    // resend mints a new credential, which kills the old one. Offering only the
    // second would mean every gentle chase silently breaks a link somebody may
    // have open — see `envelopes_remind`'s header.
    const handleRemind = () =>
        mRemind.mutation.mutateAsync({
            organization_id: organizationId,
            envelope_id: envelopeId,
        });

    // Issue-then-open. Both server calls live in the hook, because the archive
    // page presses the same button and the two must not drift.
    const handleCertificate = () =>
        mCertificate.mutation.mutate({
            organization_id: organizationId,
            envelope_id: envelopeId,
        });
    // The one action that moves the routing backwards. It stays out of the header
    // button bar on purpose: the buttons up there act on the DOCUMENT, and this
    // acts on one named party, so it belongs beside that party in the list where
    // the sender can see who they are picking.
    const handleRequestChanges = async (reason: string) => {
        if (!changesTarget) return;
        try {
            await mRequestChanges.mutation.mutateAsync({
                organization_id: organizationId,
                envelope_id: envelopeId,
                signer_id: changesTarget.id,
                reason,
            });
            setChangesTarget(null);
        } catch {
            // The hook surfaces the server's message. Leaving the modal open keeps
            // what the sender typed, which they would otherwise have to retype.
        }
    };

    const handleResend = () =>
        modal.confirm({
            title: "Send the link again?",
            content:
                "A new signing link is emailed and the previous one stops working. Anyone still holding the old email will need this new one.",
            okText: "Send new link",
            onOk: () =>
                mResend.mutation.mutateAsync({
                    organization_id: organizationId,
                    envelope_id: envelopeId,
                }),
        });

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: token.marginSM,
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                    borderBottom: `1px solid ${token.colorBorder}`,
                    flexShrink: 0,
                }}
            >
                <Button
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    onClick={() =>
                        navigate({
                            ...Utils_Scope_Route.envelopes(scope, organizationId),
                            search: { status: "all" },
                        })
                    }
                />
                <Typography.Title level={5} ellipsis style={{ margin: 0, flex: 1, minWidth: 0 }}>
                    {envelope.title}
                </Typography.Title>
                <App_EnvelopeStatusTag status={envelope.status} />

                {/* ICON-ONLY ON A PHONE. Labelled, these four buttons need ~620px
                    of a row that also holds a back arrow, the title and a status
                    tag. Every one that loses its label is already wrapped in the
                    Tooltip that explains it, so the affordance survives the cut —
                    except Download, which is the completed state's whole point and
                    keeps its label. */}
                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: token.marginXS,
                    }}
                >
                    {canAct && (
                        <Tooltip title="Emails a nudge. Their existing signing link keeps working.">
                            <Button
                                icon={<BellOutlined />}
                                loading={mRemind.mutation.isPending}
                                onClick={handleRemind}
                            >
                                {isMobile ? null : "Remind"}
                            </Button>
                        </Tooltip>
                    )}
                    {canAct && (
                        <Tooltip title="Issues a new signing link. The one they already have stops working.">
                            <Button
                                icon={<RedoOutlined />}
                                loading={mResend.mutation.isPending}
                                onClick={handleResend}
                            >
                                {isMobile ? null : "Resend link"}
                            </Button>
                        </Tooltip>
                    )}
                    {isCompleted && (
                        <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            loading={mDownload.mutation.isPending}
                            onClick={() =>
                                mDownload.mutation.mutate({
                                    organization_id: organizationId,
                                    envelope_id: envelopeId,
                                })
                            }
                        >
                            Download signed PDF
                        </Button>
                    )}
                    {/* CG-043. Offered only on a completed document, so it
                        disappears rather than failing when pressed — the rule
                        v1.1 Phase F set for "Request changes". Secondary to
                        Download: the signed contract is what people came for,
                        the certificate is what they need when someone disputes
                        it. */}
                    {isCompleted && (
                        <Tooltip title="A PDF summarising every party, how each proved who they were, and the full audit trail. Re-issued automatically if the trail has grown since it was last produced.">
                            <Button
                                icon={<AuditOutlined />}
                                loading={mCertificate.mutation.isPending}
                                onClick={handleCertificate}
                            >
                                {isMobile ? null : "Certificate"}
                            </Button>
                        </Tooltip>
                    )}
                    {canAct && (
                        <Tooltip title="Void">
                            <Button
                                danger
                                icon={<StopOutlined />}
                                onClick={() => setVoidOpen(true)}
                            >
                                {isMobile ? null : "Void"}
                            </Button>
                        </Tooltip>
                    )}
                </div>
            </div>

            {/* `display: flex` + `minHeight: 0` rather than `overflow: auto`.
                A PDF viewer needs a BOUNDED height to size its own scroll area
                against; giving this container the scrollbar instead would let the
                viewer grow without limit and take the whole page with it.

                The cost is that the audit tab loses the page-level scrollbar it
                used to inherit, so it gets its own below. */}
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    padding: isMobile ? token.paddingSM : token.paddingMD,
                }}
            >
                <Tabs
                    defaultActiveKey="overview"
                    style={{ height: "100%", width: "100%" }}
                    items={[
                        {
                            key: "overview",
                            label: "Overview",
                            children: (
                                <div
                                    style={{
                                        display: "flex",
                                        // Below `lg` the split stops being worth
                                        // having — a ~380px PDF is unreadable — so
                                        // the panes stack with the details first
                                        // and the document below them.
                                        flexDirection: isWide ? "row" : "column",
                                        gap: token.marginLG,
                                        height: "100%",
                                        minHeight: 0,
                                        overflow: isWide ? "hidden" : "auto",
                                    }}
                                >
                                    {/* LEFT: the document itself. */}
                                    <div
                                        style={{
                                            display: "flex",
                                            flex: isWide ? "1 1 0" : "0 0 auto",
                                            minWidth: 0,
                                            // A flat 480px is taller than the
                                            // visible area on a phone in portrait,
                                            // which put the whole details column
                                            // below a fold the reader has to scroll
                                            // past before seeing anything. `60vh`
                                            // keeps the pane a pane.
                                            minHeight: isWide ? 0 : "min(60vh, 480px)",
                                            height: isWide ? "100%" : "min(60vh, 480px)",
                                            order: isWide ? 0 : 1,
                                        }}
                                    >
                                        <App_EnvelopeDocumentViewer
                                            organizationId={organizationId}
                                            envelopeId={envelopeId}
                                            layout={layout}
                                            roles={roles}
                                            values={fieldValues}
                                        />
                                    </div>

                                    {/* RIGHT: everything about the document.
                                        Recipients and details share one scrolling
                                        column so the viewer keeps a stable width. */}
                                    <div
                                        style={{
                                            flex: isWide ? "0 0 400px" : "0 0 auto",
                                            minHeight: 0,
                                            overflow: isWide ? "auto" : "visible",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: token.marginLG,
                                            order: isWide ? 1 : 0,
                                        }}
                                    >
                                        <div>
                                            <Typography.Text strong>Recipients</Typography.Text>
                                            <div style={{ marginTop: token.marginSM }}>
                                                <App_EnvelopeSignerList
                                                    signers={signers}
                                                    roles={roles}
                                                    currentOrder={envelope.current_order}
                                                    isInFlight={isInFlight}
                                                    // `canAct`, not `isInFlight`:
                                                    // sending a party's turn back
                                                    // is the same `send_documents`
                                                    // write as voiding the document.
                                                    onRequestChanges={
                                                        canAct ? setChangesTarget : undefined
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            {/* Vertical on a phone: `bordered` gives the
                                                label column ~45% of 358px, and what is
                                                left cannot hold a truncated PDF hash and
                                                its copy icon without wrapping mid-token. */}
                                            <Descriptions
                                                column={1}
                                                size="small"
                                                bordered
                                                layout={isMobile ? "vertical" : "horizontal"}
                                                title="Document"
                                            >
                                                <Descriptions.Item label="Sent">
                                                    {envelope.sent_at
                                                        ? new Date(
                                                              envelope.sent_at
                                                          ).toLocaleString()
                                                        : "—"}
                                                </Descriptions.Item>
                                                <Descriptions.Item label="Completed">
                                                    {envelope.completed_at
                                                        ? new Date(
                                                              envelope.completed_at
                                                          ).toLocaleString()
                                                        : "—"}
                                                </Descriptions.Item>
                                                {/* The deadline is shown for every
                                                    status, not only in-flight ones: on
                                                    an expired document it is the
                                                    explanation, and on a completed one
                                                    it is the deadline that was met. */}
                                                <Descriptions.Item label="Deadline">
                                                    {envelope.expires_at ? (
                                                        <>
                                                            {new Date(
                                                                envelope.expires_at
                                                            ).toLocaleString()}
                                                            {expiry.kind === "soon" && (
                                                                <Typography.Text type="warning">
                                                                    {" "}
                                                                    ·{" "}
                                                                    {expiry.days === 1
                                                                        ? "1 day left"
                                                                        : `${expiry.days} days left`}
                                                                </Typography.Text>
                                                            )}
                                                            {/* Reachable for up to an
                                                                hour: the expiry job runs
                                                                hourly, so the status can
                                                                lag the clock. */}
                                                            {expiry.kind === "passed" && (
                                                                <Typography.Text type="warning">
                                                                    {" "}
                                                                    · overdue, closing shortly
                                                                </Typography.Text>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <Typography.Text type="secondary">
                                                            no deadline
                                                        </Typography.Text>
                                                    )}
                                                </Descriptions.Item>
                                                <Descriptions.Item label="Reminders">
                                                    {reminderDays.length > 0 ? (
                                                        `Days ${reminderDays.join(", ")} after sending`
                                                    ) : (
                                                        <Typography.Text type="secondary">
                                                            none scheduled
                                                        </Typography.Text>
                                                    )}
                                                </Descriptions.Item>
                                                {/* CG-031. Sits with the terms of the
                                                    send rather than with the hashes,
                                                    because it is one: it says what the
                                                    signatures below it rest on. A sender
                                                    chasing an unsigned document also
                                                    needs it to know whether the
                                                    recipient is stuck at a sign-in or at
                                                    a passcode — two different rescues. */}
                                                <Descriptions.Item label="Recipients sign">
                                                    <Tag color={signerAuthOption.color}>
                                                        {signerAuthOption.label}
                                                    </Tag>
                                                    {hasAuthOverride && (
                                                        <Typography.Text
                                                            type="secondary"
                                                            style={{ fontSize: 12 }}
                                                        >
                                                            except where noted on a recipient
                                                        </Typography.Text>
                                                    )}
                                                </Descriptions.Item>
                                                {/* [ekyc] CG-033. Rendered only
                                                    when the document actually
                                                    asks for one — a row saying
                                                    "not required" on every
                                                    envelope would be noise on a
                                                    page that already has a lot
                                                    of rows. */}
                                                {envelope.require_identity_check && (
                                                    <Descriptions.Item label="Identity check">
                                                        <Tag color="purple">Required</Tag>
                                                        <Typography.Text
                                                            type="secondary"
                                                            style={{ fontSize: 12 }}
                                                        >
                                                            recipients verify a government ID before
                                                            signing
                                                        </Typography.Text>
                                                    </Descriptions.Item>
                                                )}
                                                {/* The digests are the point of the
                                                    exercise — shown truncated with the
                                                    full value on hover so they can be
                                                    compared against a downloaded file. */}
                                                <Descriptions.Item label="Source PDF hash">
                                                    <Tooltip title={envelope.source_pdf_sha256}>
                                                        <Typography.Text
                                                            copyable={{
                                                                text: envelope.source_pdf_sha256,
                                                            }}
                                                            style={{ fontFamily: "monospace" }}
                                                        >
                                                            {envelope.source_pdf_sha256.slice(
                                                                0,
                                                                16
                                                            )}
                                                            …
                                                        </Typography.Text>
                                                    </Tooltip>
                                                </Descriptions.Item>
                                                <Descriptions.Item label="Signed PDF hash">
                                                    {envelope.signed_pdf_sha256 ? (
                                                        <Tooltip title={envelope.signed_pdf_sha256}>
                                                            <Typography.Text
                                                                copyable={{
                                                                    text: envelope.signed_pdf_sha256,
                                                                }}
                                                                style={{ fontFamily: "monospace" }}
                                                            >
                                                                {envelope.signed_pdf_sha256.slice(
                                                                    0,
                                                                    16
                                                                )}
                                                                …
                                                            </Typography.Text>
                                                        </Tooltip>
                                                    ) : (
                                                        <Typography.Text type="secondary">
                                                            not generated yet
                                                        </Typography.Text>
                                                    )}
                                                </Descriptions.Item>
                                                {/* CG-043. Shown only once one exists, so a
                                                    completed document that nobody has needed a
                                                    certificate for does not carry an empty row
                                                    inviting the question. It states the ISSUE
                                                    date beside the hash because a certificate,
                                                    unlike the two hashes above it, is a snapshot
                                                    that can legitimately be superseded. */}
                                                {envelope.certificate_sha256 && (
                                                    <Descriptions.Item label="Certificate">
                                                        <Tooltip
                                                            title={envelope.certificate_sha256}
                                                        >
                                                            <Typography.Text
                                                                copyable={{
                                                                    text: envelope.certificate_sha256,
                                                                }}
                                                                style={{ fontFamily: "monospace" }}
                                                            >
                                                                {envelope.certificate_sha256.slice(
                                                                    0,
                                                                    16
                                                                )}
                                                                …
                                                            </Typography.Text>
                                                        </Tooltip>
                                                        {envelope.certificate_generated_at && (
                                                            <Typography.Text
                                                                type="secondary"
                                                                style={{
                                                                    marginLeft: token.marginXS,
                                                                }}
                                                            >
                                                                issued{" "}
                                                                {new Date(
                                                                    envelope.certificate_generated_at
                                                                ).toLocaleString()}
                                                            </Typography.Text>
                                                        )}
                                                    </Descriptions.Item>
                                                )}
                                            </Descriptions>

                                            {isCompleted && (
                                                // Plan risk 6 — a mock-signed document
                                                // must never be mistakable for a real
                                                // one, and the place that matters most
                                                // is the finished document's own page.
                                                <Alert
                                                    type="info"
                                                    showIcon
                                                    style={{ marginTop: token.marginMD }}
                                                    message="Recorded, not certified"
                                                    description="This document carries signature images, field values, hashes and a verifiable audit chain. It does not carry a cryptographic (PAdES) signature."
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "audit",
                            label: "Audit trail",
                            // Its own scrollbar now that the page no longer has one.
                            children: (
                                <div style={{ height: "100%", overflow: "auto" }}>
                                    <App_EnvelopeTimeline
                                        envelopeId={envelopeId}
                                        documentTitle={envelope.title}
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            </div>

            <Modal
                open={voidOpen}
                title="Void this document?"
                okText="Void document"
                okButtonProps={{ danger: true, loading: mVoid.mutation.isPending }}
                onOk={handleVoid}
                onCancel={() => setVoidOpen(false)}
                destroyOnHidden
                {...Utils_Modal_Responsive(isMobile)}
            >
                <Typography.Paragraph>
                    Every signing link stops working immediately and nobody can sign. The document
                    and its audit trail are kept — voiding is recorded, not erased.
                </Typography.Paragraph>
                <Input.TextArea
                    rows={3}
                    placeholder="Reason (optional, recorded in the audit trail)"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                />
            </Modal>

            <App_EnvelopeRequestChangesModal
                open={!!changesTarget}
                signerName={changesTarget?.signer_name ?? ""}
                documentTitle={envelope.title}
                // The rewind closes a later party's turn only when the route has
                // actually moved past this signer. Saying so unconditionally would
                // warn about a consequence that usually does not happen — the
                // common case is sending back the party the document is waiting on.
                rewindsPastOthers={
                    !!changesTarget && envelope.current_order > changesTarget.signer_order
                }
                isSubmitting={mRequestChanges.mutation.isPending}
                onCancel={() => setChangesTarget(null)}
                onConfirm={handleRequestChanges}
            />
        </div>
    );
};
