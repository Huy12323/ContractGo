import { useMemo, useState } from "react";
import {
    Alert,
    Button,
    Empty,
    Segmented,
    Select,
    Tag,
    Timeline,
    Tooltip,
    Typography,
    theme,
} from "antd";
import {
    AuditOutlined,
    BellOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DesktopOutlined,
    DisconnectOutlined,
    EditOutlined,
    EyeOutlined,
    FileAddOutlined,
    FilePdfOutlined,
    FormOutlined,
    GlobalOutlined,
    IdcardOutlined, // [ekyc]
    KeyOutlined,
    LinkOutlined,
    LockOutlined,
    LoginOutlined,
    MailOutlined,
    RobotOutlined,
    RollbackOutlined,
    SafetyCertificateOutlined,
    DownloadOutlined,
    SafetyOutlined,
    SendOutlined,
    StopOutlined,
    SwapOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    useQ_Envelope_VerifyChain,
    useQ_Tables_EnvelopeAuditLog,
} from "@/hooks/useQ_Tables_EnvelopeAuditLog";
import {
    utils_Envelope_AuditExportCsv,
    utils_Envelope_AuditExportFilename,
    utils_Envelope_AuditExportJson,
} from "@/components/envelopes/utils_Envelope_AuditExport";
import type { Database } from "@/types/database.types";

type EnvelopeAuditEventType = Database["public"]["Enums"]["signature_audit_log_event_type_enum"];

// The audit trail — the legal artifact, rendered.
//
// Every row carries `seq`, `prev_hash` and `entry_hash`; the chain is what makes
// the trail evidence rather than a log, so the hashes are shown (truncated, on
// hover) rather than hidden as implementation detail. "Verify chain" asks
// Postgres to rehash the whole trail with the same IMMUTABLE function that wrote
// it — see the hook for why that cannot be done in the browser.
//
// Event types are labelled here rather than in a const file because they are
// display copy for one component, and because the enum is append-only by nature:
// an unlabelled future event renders its raw type, which is honest, instead of
// disappearing from the trail.
//
// The map is nonetheless typed against the enum, so adding a value to
// `signature_audit_log_event_type_enum` without labelling it fails the BUILD.
// The two are not in tension and both are wanted: the type stops US shipping an
// unlabelled event, and the `??` fallback at the render site still covers a
// database whose enum is ahead of these generated types — which is exactly the
// window in which the raw-type rendering is the honest thing to do.
//
// WHAT CHANGED IN THE READABILITY PASS, and what deliberately did not. Each entry
// gained an ICON, a `category` for filtering, and a fixed five-row grammar; it
// did not lose a single field it used to show. Identity is now carried by the
// icon rather than by colour, which is what lets the colour vocabulary below
// shrink to "failure, success, everything else" without rows becoming
// indistinguishable.

type EventCategory = "lifecycle" | "delivery" | "access" | "signing" | "document" | "integrity";

type EventMeta = {
    label: string;
    icon: React.ReactNode;
    category: EventCategory;
};

const EVENT_META: Record<EnvelopeAuditEventType, EventMeta> = {
    request_created: {
        label: "Document created",
        icon: <FileAddOutlined />,
        category: "lifecycle",
    },
    request_updated: { label: "Draft edited", icon: <EditOutlined />, category: "lifecycle" },
    request_sent: { label: "Sent for signature", icon: <SendOutlined />, category: "lifecycle" },
    signer_token_issued: {
        label: "Signing link issued",
        icon: <LinkOutlined />,
        category: "delivery",
    },
    signer_notified: { label: "Recipient emailed", icon: <MailOutlined />, category: "delivery" },
    signer_token_redeemed: {
        label: "Signing link opened",
        icon: <LoginOutlined />,
        category: "access",
    },
    signer_viewed: { label: "Document viewed", icon: <EyeOutlined />, category: "access" },
    signer_fields_saved: { label: "Entries saved", icon: <FormOutlined />, category: "signing" },
    signer_signed: { label: "Signed", icon: <SafetyCertificateOutlined />, category: "signing" },
    signer_declined: { label: "Declined", icon: <StopOutlined />, category: "signing" },
    signer_access_denied: { label: "Access denied", icon: <LockOutlined />, category: "access" },
    signer_reminded: { label: "Reminder sent", icon: <BellOutlined />, category: "delivery" },
    // CG-031. One icon across the three so the passcode exchange reads as a
    // single episode when a sender scans the trail, and the categories split by
    // what each one IS: sending a code is a delivery, answering it is an access
    // event, and failing to answer it is the same kind of access event as
    // `signer_access_denied` sitting just above.
    //
    // Deliberately NOT coloured, under this file's existing rule that only
    // `signer_access_denied` is. One mistyped digit is the commonest thing that
    // happens on this surface; a trail that shouted at every fat finger would
    // train senders to ignore the colour that means a link leaked. Five failures
    // in a row do produce a red entry — the attempt cap turns them into
    // `signer_access_denied`, which is where the alarm belongs.
    signer_otp_issued: { label: "Passcode emailed", icon: <KeyOutlined />, category: "delivery" },
    signer_otp_verified: {
        label: "Passcode confirmed",
        icon: <KeyOutlined />,
        category: "access",
    },
    signer_otp_failed: {
        label: "Wrong passcode entered",
        icon: <KeyOutlined />,
        category: "access",
    },
    // [ekyc] CG-033. Categorised `access` to sit with `signer_access_denied` and
    // the passcode pair: an identity check is a gate on acting, not a delivery.
    //
    // The labels say what HAPPENED rather than naming the vendor category, for
    // the same reason the enum values do (`signer_identity_*`, not
    // `signer_ekyc_*`): if the eKYC driver is ever removed and a notary or
    // national-eID flow replaces it, these entries stay correct.
    //
    // Not coloured, under this file's rule that only `signer_access_denied` is —
    // and a signer who cannot pass the check ends up producing one of those
    // anyway when they try to submit, which is where the alarm belongs.
    signer_identity_started: {
        label: "Identity check started",
        icon: <IdcardOutlined />,
        category: "access",
    },
    signer_identity_verified: {
        label: "Identity verified",
        icon: <IdcardOutlined />,
        category: "access",
    },
    signer_identity_failed: {
        label: "Identity check failed",
        icon: <IdcardOutlined />,
        category: "access",
    },
    signer_token_revoked: {
        label: "Signing link revoked",
        icon: <DisconnectOutlined />,
        category: "delivery",
    },
    sender_requested_changes: {
        label: "Changes requested by sender",
        icon: <RollbackOutlined />,
        category: "lifecycle",
    },
    capture_superseded: {
        label: "Earlier signature superseded",
        icon: <SwapOutlined />,
        category: "signing",
    },
    cc_notified: { label: "Observer emailed a copy", icon: <MailOutlined />, category: "delivery" },
    document_burned: {
        label: "Document generated",
        icon: <FilePdfOutlined />,
        category: "document",
    },
    document_signed: {
        label: "Document cryptographically signed",
        icon: <SafetyCertificateOutlined />,
        category: "document",
    },
    request_completed: {
        label: "Completed",
        icon: <CheckCircleOutlined />,
        category: "lifecycle",
    },
    request_expired: { label: "Expired", icon: <ClockCircleOutlined />, category: "lifecycle" },
    request_cancelled: { label: "Voided", icon: <CloseCircleOutlined />, category: "lifecycle" },
    integrity_verified: {
        label: "Integrity verified",
        icon: <SafetyOutlined />,
        category: "integrity",
    },
    // CG-043. "Certificate issued", not "Certificate generated": the entry
    // records that a sender produced the summarising artifact, and a reader of
    // an evidence trail should not have to wonder whether "generated" means
    // something was computed about the document itself. It is `integrity`
    // rather than `document` for the same reason `integrity_verified` is — the
    // document did not change, a statement about it was made.
    //
    // Appears at most once per state of the chain: the generator re-issues only
    // when the trail has grown since the last certificate, so a run of these
    // entries is a record of real changes, not of repeated downloads.
    certificate_generated: {
        label: "Certificate issued",
        icon: <AuditOutlined />,
        category: "integrity",
    },
    // CG-049. "Used the document assistant", not "Asked a question", because
    // exactly one entry is written per signing link no matter how many questions
    // follow — a label in the singular would imply a count the trail does not
    // record and cannot support.
    //
    // WHAT THIS ROW DOES NOT CONTAIN, and it is the point of the entry: no
    // question text and no answer text, ever. The transcript is deliberately not
    // sender-visible. A signer's questions are their own words about why they
    // hesitate, and this trail is rendered onto a Certificate of Completion that
    // goes to the counterparty — see the CG-049 migration's PHASE 7. The row
    // records the FACT and the extraction hash, which is what a later dispute
    // about "what were they shown" actually needs.
    //
    // `access` rather than `document`: nothing about the document changed. It
    // sits with the other entries that record what a recipient did with the link
    // they were given.
    signer_ai_question_asked: {
        label: "Used the document assistant",
        icon: <RobotOutlined />,
        category: "access",
    },
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
    lifecycle: "Lifecycle",
    delivery: "Delivery",
    access: "Access",
    signing: "Signing",
    document: "Document",
    integrity: "Integrity",
};

// Only the failure case is coloured. A trail where every entry shouts is a trail
// nobody reads; `signer_access_denied` is the one entry that means someone
// should look, so it is the one that stands out.
//
// The neutral case is GREY rather than the blue it used to be: blue applied to
// twenty of the twenty-two event types, which made it decoration rather than
// signal. Nothing depends on colour alone now — the icon carries the identity —
// so this vocabulary can afford to be this small.
type EventTone = "negative" | "positive" | "neutral";

const eventTone = (eventType: string): EventTone =>
    eventType === "signer_access_denied" || eventType === "signer_declined"
        ? "negative"
        : eventType === "request_completed"
          ? "positive"
          : "neutral";

// ============================================================
// Reading the evidence out of a payload
// ============================================================
// DEFENSIVELY, every field, and that is not paranoia about our own writers: the
// payload is inside the chain hash, so entries written before CG-016 added the
// `actor` and `auth` blocks can never be back-filled — rewriting one would break
// the very chain that makes it evidence. A trail therefore legitimately contains
// both shapes forever, and this renders whichever it finds rather than showing a
// blank row for the older half.

type AuditActor = {
    kind?: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value : null;

const actorOf = (payload: Record<string, unknown>): AuditActor => {
    const actor = asRecord(payload.actor);
    return {
        kind: asString(actor.kind) ?? undefined,
        name: asString(actor.name),
        // Pre-CG-016 entries carry the signer's address and nothing else. It is
        // the actor's email on those rows, so it is read as one.
        email: asString(actor.email) ?? asString(payload.signer_email),
        phone: asString(actor.phone),
    };
};

/** "Nguyen Van A (a@example.com, +84 90 123 4567)" — as much as was recorded. */
const describeActor = (actor: AuditActor): string | null => {
    const contact = [actor.email, actor.phone].filter(Boolean).join(", ");
    if (actor.name && contact) return `${actor.name} (${contact})`;
    return actor.name ?? contact ?? null;
};

/**
 * The events where "which checks stood behind this?" is the question being asked
 * — a party committing, refusing, or being turned away. Those get the explicit
 * "OTP not used" / "eKYC not used" statements; the rest just list what was used.
 */
const AUTH_STRENGTH_EVENTS = new Set<string>([
    "signer_signed",
    "signer_declined",
    "signer_access_denied",
    "document_signed",
]);

const AUTH_METHOD_LABELS: Record<string, string> = {
    email_link: "Email link",
    // CG-047. Named distinctly from "Email link" and not folded into it: the
    // reader of a timeline is trying to establish how someone got to the
    // document, and "the sender's own system put a signing pane on a page" is a
    // materially different answer from "a link reached their mailbox".
    embed_link: "Embedded link",
    app_session: "Account session",
    drawn_signature: "Drawn signature",
    typed_signature: "Typed signature",
    uploaded_signature: "Uploaded signature",
    otp: "OTP",
    ekyc: "eKYC",
    ca_digital_signature: "CA digital signature",
    system_scheduler: "Automatic",
    api_key: "API key",
};

type AuthEvidence = {
    methods: string[];
    /** `false` on an entry whose writer recorded no authentication at all. */
    recorded: boolean;
    /** The session assurance level behind a sender's action, when known. */
    aal: string | null;
    /** True when the check was performed; false when it explicitly was not. */
    otp: boolean;
    ekyc: boolean;
};

const authOf = (payload: Record<string, unknown>): AuthEvidence | null => {
    if (!("auth" in payload)) return null;
    const auth = asRecord(payload.auth);
    const session = asRecord(auth.session);
    return {
        methods: Array.isArray(auth.methods)
            ? auth.methods.filter((m): m is string => typeof m === "string")
            : [],
        recorded: auth.recorded !== false,
        aal: asString(session.aal),
        // `null` means "was not performed", which is a real answer and is shown
        // as such — see the OTP/eKYC note in `_shared/auditEvidence.ts`.
        otp: !!auth.otp,
        ekyc: !!auth.ekyc,
    };
};

/**
 * To the second, and in the reader's own zone. A trail whose times round to the
 * minute cannot order two events inside one — which is exactly the interval a
 * signing ceremony's steps fall into.
 */
const formatTimeOfDay = (iso: string): string =>
    new Date(iso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

const formatDayHeading = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });

type AuditEntry = ReturnType<typeof useQ_Tables_EnvelopeAuditLog>["entries"][number];

// ============================================================
// One entry
// ============================================================

/**
 * A fixed five-row grammar — what · who · where · how · proof — so the eye learns
 * where to look instead of re-reading a stack of same-weight lines. Rows with
 * nothing to say render nothing rather than a placeholder.
 *
 * `time` is passed only on mobile, where the `Timeline`'s own label gutter is
 * given up (see the caller) and the clock has to come back somewhere — next to
 * `#seq`, which is the other piece of positional metadata on the row.
 */
const TimelineEntry = ({
    entry,
    time,
    isMobile,
}: {
    entry: AuditEntry;
    time?: string;
    isMobile: boolean;
}) => {
    const { token } = theme.useToken();

    const payload = asRecord(entry.payload);
    const actor = actorOf(payload);
    const who = describeActor(actor);
    const ip = asString(payload.ip);
    const userAgent = asString(payload.user_agent);
    const auth = authOf(payload);
    const isSystem = actor.kind === "system";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* WHAT */}
            <div style={{ display: "flex", alignItems: "baseline", gap: token.marginXS }}>
                <Typography.Text strong style={{ flex: 1, minWidth: 0 }}>
                    {EVENT_META[entry.event_type]?.label ?? entry.event_type}
                </Typography.Text>
                {/* Kept visible at all times: now that the trail can be filtered,
                    a gap in the sequence is how a reader tells the view is partial. */}
                <Typography.Text
                    type="secondary"
                    style={{
                        fontFamily: "monospace",
                        fontSize: token.fontSizeSM,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                    }}
                >
                    {time && `${time}  `}#{entry.seq}
                </Typography.Text>
            </div>

            {/* WHO — on its own line rather than appended to the timestamp.
                Identification is the field a dispute turns on, and burying it in a
                run-on line of metadata is how it gets missed. */}
            <div style={{ display: "flex", alignItems: "center", gap: token.marginXXS }}>
                {isSystem ? (
                    <RobotOutlined
                        style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}
                    />
                ) : (
                    <UserOutlined
                        style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}
                    />
                )}
                <Typography.Text style={{ fontSize: token.fontSizeSM }}>
                    {who ?? (isSystem ? "Automatic — no user acted" : "Performer not recorded")}
                </Typography.Text>
            </div>

            {/* WHERE. The user agent used to be hidden inside the hash tooltip,
                where nobody asking "which device" would ever have found it. */}
            {(ip || userAgent) && (
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: token.marginSM,
                    }}
                >
                    {ip && (
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            <GlobalOutlined /> {ip}
                        </Typography.Text>
                    )}
                    {userAgent && (
                        <Tooltip title={userAgent}>
                            <Typography.Text
                                type="secondary"
                                ellipsis
                                style={{
                                    fontSize: token.fontSizeSM,
                                    // On a phone a user agent never shares a line with
                                    // the IP and win — it takes its own wrapped line and
                                    // ellipsizes against the full width instead of a
                                    // 150px remainder.
                                    ...(isMobile
                                        ? { flex: "1 1 100%", maxWidth: "100%" }
                                        : { maxWidth: 260 }),
                                }}
                            >
                                <DesktopOutlined /> {userAgent}
                            </Typography.Text>
                        </Tooltip>
                    )}
                </div>
            )}

            {/* HOW. Absent entirely on entries written before CG-016 — shown as
                nothing rather than as "none", which would be a claim the trail
                cannot support. */}
            {auth &&
                (auth.methods.length > 0 ||
                    auth.aal ||
                    AUTH_STRENGTH_EVENTS.has(entry.event_type)) && (
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: token.marginXXS,
                            marginTop: token.marginXXS,
                            padding: token.paddingXXS,
                            background: token.colorFillQuaternary,
                            borderRadius: token.borderRadiusSM,
                        }}
                    >
                        <SafetyOutlined
                            style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}
                        />
                        {auth.methods.map((method) => (
                            <Tag key={method} color="blue" style={{ marginInlineEnd: 0 }}>
                                {AUTH_METHOD_LABELS[method] ?? method}
                            </Tag>
                        ))}
                        {auth.aal && (
                            <Tooltip title="Session assurance level from the signed token — aal2 means a second factor was satisfied.">
                                <Tag style={{ marginInlineEnd: 0 }}>{auth.aal}</Tag>
                            </Tooltip>
                        )}
                        {/* Stated in the negative on purpose: "OTP not used" is
                            evidence about the ceremony, and an omitted tag would
                            leave the reader unable to tell it from an unrecorded
                            one.

                            Only on the entries where the question is actually asked
                            — the moments a party committed or refused. On all
                            twenty other event types these two tags would appear on
                            every row and be read by nobody. */}
                        {auth.recorded && AUTH_STRENGTH_EVENTS.has(entry.event_type) && (
                            <>
                                {!auth.otp && (
                                    <Tag style={{ marginInlineEnd: 0 }}>OTP not used</Tag>
                                )}
                                {!auth.ekyc && (
                                    <Tag style={{ marginInlineEnd: 0 }}>eKYC not used</Tag>
                                )}
                            </>
                        )}
                    </div>
                )}

            {/* PROOF. `copyable` is new and free — a hash nobody can copy is a hash
                nobody can check. `prev_hash` was already being fetched and never
                shown; together the pair is what makes the link auditable by hand. */}
            <Tooltip
                title={
                    <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                        <div>entry: {entry.entry_hash}</div>
                        <div>prev: {entry.prev_hash ?? "— (first entry)"}</div>
                    </div>
                }
            >
                <Typography.Text
                    type="secondary"
                    copyable={{ text: entry.entry_hash }}
                    style={{ fontSize: token.fontSizeSM, fontFamily: "monospace" }}
                >
                    {entry.entry_hash.slice(0, 16)}…
                </Typography.Text>
            </Tooltip>
        </div>
    );
};

// ============================================================
// The trail
// ============================================================

export const App_EnvelopeTimeline = ({
    envelopeId,
    documentTitle = "",
    organizationName = null,
}: {
    envelopeId: string;
    /** For the export header. Optional so no existing call site breaks. */
    documentTitle?: string;
    organizationName?: string | null;
}) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const qAudit = useQ_Tables_EnvelopeAuditLog({ envelopeId });
    const qVerify = useQ_Envelope_VerifyChain({ envelopeId });

    const [category, setCategory] = useState<EventCategory | "all">("all");
    const [eventTypes, setEventTypes] = useState<string[]>([]);
    const [actorFilter, setActorFilter] = useState<string | null>(null);

    /**
     * Hands the file to the browser.
     *
     * A blob URL rather than a server round trip: every byte is already in the
     * page, and asking a server to re-serialise rows the client is looking at
     * would add an endpoint, a permission and a failure mode for nothing. It also
     * keeps the export writing NOTHING to the trail it is exporting — see
     * `utils_Envelope_AuditExport`'s header.
     *
     * The object URL is revoked on the next frame: leaving it alive pins the
     * whole serialised trail in memory for the life of the tab.
     */
    const download = (contents: string, filename: string, mime: string) => {
        const url = URL.createObjectURL(new Blob([contents], { type: mime }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        requestAnimationFrame(() => URL.revokeObjectURL(url));
    };

    const handleExport = (format: "csv" | "json") => {
        const exportedAt = new Date().toISOString();
        const meta = {
            envelopeId,
            documentTitle,
            organizationName,
            exportedAt,
            // The verdict is included ONLY if the user actually pressed Verify.
            // Reporting "intact" because nobody checked would be the one lie this
            // file cannot afford.
            chain: qVerify.result ?? null,
        };
        download(
            format === "csv"
                ? utils_Envelope_AuditExportCsv(qAudit.entries, meta)
                : utils_Envelope_AuditExportJson(qAudit.entries, meta),
            utils_Envelope_AuditExportFilename(envelopeId, exportedAt, format),
            format === "csv" ? "text/csv;charset=utf-8" : "application/json"
        );
    };

    const toneColor = (tone: EventTone) =>
        tone === "negative"
            ? token.colorError
            : tone === "positive"
              ? token.colorSuccess
              : token.colorTextTertiary;

    /** Only the event types this trail actually contains — a filter offering
     *  twenty-two options for a six-entry trail is a filter nobody opens. */
    const presentEventTypes = useMemo(() => {
        const seen = new Set<string>();
        for (const entry of qAudit.entries) seen.add(entry.event_type);
        return [...seen].map((type) => ({
            value: type,
            label: EVENT_META[type as EnvelopeAuditEventType]?.label ?? type,
        }));
    }, [qAudit.entries]);

    const presentActors = useMemo(() => {
        const seen = new Set<string>();
        for (const entry of qAudit.entries) {
            const who = describeActor(actorOf(asRecord(entry.payload)));
            if (who) seen.add(who);
        }
        return [...seen].map((who) => ({ value: who, label: who }));
    }, [qAudit.entries]);

    const filtered = useMemo(
        () =>
            qAudit.entries.filter((entry) => {
                const meta = EVENT_META[entry.event_type];
                if (category !== "all" && meta?.category !== category) return false;
                if (eventTypes.length > 0 && !eventTypes.includes(entry.event_type)) return false;
                if (actorFilter) {
                    const who = describeActor(actorOf(asRecord(entry.payload)));
                    if (who !== actorFilter) return false;
                }
                return true;
            }),
        [qAudit.entries, category, eventTypes, actorFilter]
    );

    /** Grouped by local calendar day, `seq` order preserved inside each group.
     *  This is what moves the timestamp out of the body and turns the left gutter
     *  into a time ruler the eye can scan. */
    const days = useMemo(() => {
        const groups: { key: string; heading: string; entries: typeof filtered }[] = [];
        for (const entry of filtered) {
            const key = new Date(entry.occurred_at).toDateString();
            const last = groups[groups.length - 1];
            if (last && last.key === key) last.entries.push(entry);
            else
                groups.push({
                    key,
                    heading: formatDayHeading(entry.occurred_at),
                    entries: [entry],
                });
        }
        return groups;
    }, [filtered]);

    const isFiltering = category !== "all" || eventTypes.length > 0 || !!actorFilter;

    /** One list, two controls — a `Segmented` on desktop and a `Select` on a phone,
     *  where seven segments in a row is wider than the screen. Shared so the two
     *  cannot drift as categories are added. */
    const categoryOptions = [
        { label: "All", value: "all" },
        ...(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((key) => ({
            label: CATEGORY_LABELS[key],
            value: key,
        })),
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
            {/* Verification sits OUTSIDE the filtered region on purpose: it speaks
                about the whole chain, and showing it inside a filtered view would
                invite reading "12 entries verified" as being about the 3 on screen. */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: token.marginSM,
                }}
            >
                <Button
                    icon={<SafetyCertificateOutlined />}
                    loading={qVerify.query.isFetching}
                    onClick={() => qVerify.query.refetch()}
                >
                    Verify chain
                </Button>
                {/* Beside Verify rather than in the page header: these act on the
                    TRAIL, and the header acts on the document. Disabled while the
                    trail is empty so the button cannot produce a file with a
                    header and no rows. */}
                <Button
                    icon={<DownloadOutlined />}
                    disabled={qAudit.entries.length === 0}
                    onClick={() => handleExport("csv")}
                >
                    {isMobile ? "CSV" : "Export CSV"}
                </Button>
                <Button
                    icon={<DownloadOutlined />}
                    disabled={qAudit.entries.length === 0}
                    onClick={() => handleExport("json")}
                >
                    {isMobile ? "JSON" : "Export JSON"}
                </Button>
                {qVerify.result?.chain_intact === true && (
                    <Typography.Text type="success">
                        <CheckCircleOutlined /> {qVerify.result.entries_checked} entries verified
                    </Typography.Text>
                )}
            </div>

            {/* A broken chain is the most serious thing this product can report:
                it means the evidence has been altered since it was written. It
                gets an error banner naming the exact entry, not a red tag. */}
            {qVerify.result?.chain_intact === false && (
                <Alert
                    type="error"
                    showIcon
                    message="Audit chain is broken"
                    description={`Entry #${qVerify.result.broken_at_seq} does not match its recorded hash. This trail can no longer be relied on as evidence.`}
                />
            )}

            {qAudit.entries.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No events recorded" />
            ) : (
                <>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: isMobile ? "column" : "row",
                            flexWrap: "wrap",
                            alignItems: isMobile ? "stretch" : "center",
                            gap: token.marginSM,
                        }}
                    >
                        {isMobile ? (
                            <Select
                                size="small"
                                placeholder="Category"
                                style={{ width: "100%" }}
                                value={category}
                                onChange={(value) => setCategory(value as EventCategory | "all")}
                                options={categoryOptions}
                            />
                        ) : (
                            <Segmented
                                size="small"
                                value={category}
                                onChange={(value) => setCategory(value as EventCategory | "all")}
                                options={categoryOptions}
                            />
                        )}
                        <Select
                            size="small"
                            mode="multiple"
                            allowClear
                            placeholder="Event type"
                            // `minWidth` has to go on mobile too, or a 200px floor
                            // beats the 100% and pushes the row off a 360px screen.
                            style={isMobile ? { width: "100%" } : { minWidth: 200 }}
                            value={eventTypes}
                            onChange={setEventTypes}
                            options={presentEventTypes}
                            maxTagCount="responsive"
                        />
                        {presentActors.length > 0 && (
                            <Select
                                size="small"
                                allowClear
                                placeholder="Actor"
                                // `minWidth` has to go on mobile too, or a 200px floor
                                // beats the 100% and pushes the row off a 360px screen.
                                style={isMobile ? { width: "100%" } : { minWidth: 200 }}
                                value={actorFilter}
                                onChange={(value) => setActorFilter(value ?? null)}
                                options={presentActors}
                            />
                        )}
                    </div>

                    {/* Says so out loud. A filtered trail that looks complete is the
                        one way this screen could mislead the person reading it. */}
                    {isFiltering && (
                        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            Showing {filtered.length} of {qAudit.entries.length} entries — filtering
                            changes the view, never the record.
                        </Typography.Text>
                    )}

                    {filtered.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No events match these filters"
                        />
                    ) : (
                        days.map((day) => (
                            <div key={day.key}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "baseline",
                                        gap: token.marginXS,
                                        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                                        background: token.colorFillQuaternary,
                                        borderRadius: token.borderRadiusSM,
                                        marginBottom: token.marginSM,
                                    }}
                                >
                                    <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                                        {day.heading}
                                    </Typography.Text>
                                    <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: token.fontSizeSM }}
                                    >
                                        {day.entries.length}{" "}
                                        {day.entries.length === 1 ? "event" : "events"}
                                    </Typography.Text>
                                </div>
                                <Timeline
                                    mode="left"
                                    items={day.entries.map((entry) => ({
                                        // The icon carries the event's identity; the
                                        // colour carries only its severity.
                                        dot: (
                                            <span
                                                style={{
                                                    color: toneColor(eventTone(entry.event_type)),
                                                }}
                                            >
                                                {EVENT_META[entry.event_type]?.icon ?? (
                                                    <FileAddOutlined />
                                                )}
                                            </span>
                                        ),
                                        // NO LABEL ON MOBILE, deliberately. As soon as one
                                        // item carries a `label`, antd switches the whole
                                        // timeline to its two-column layout and gives the
                                        // label `calc(50% - 12px)` — half a phone spent on
                                        // `14:03:22`, and every line of the entry wrapping
                                        // three times in what is left. The clock moves into
                                        // the entry's first row instead.
                                        label: isMobile ? undefined : (
                                            <Typography.Text
                                                type="secondary"
                                                style={{
                                                    fontFamily: "monospace",
                                                    fontSize: token.fontSizeSM,
                                                }}
                                            >
                                                {formatTimeOfDay(entry.occurred_at)}
                                            </Typography.Text>
                                        ),
                                        children: (
                                            <TimelineEntry
                                                entry={entry}
                                                isMobile={isMobile}
                                                time={
                                                    isMobile
                                                        ? formatTimeOfDay(entry.occurred_at)
                                                        : undefined
                                                }
                                            />
                                        ),
                                    }))}
                                />
                            </div>
                        ))
                    )}
                </>
            )}
        </div>
    );
};
