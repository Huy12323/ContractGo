/**
 * The in-app half of "tell someone something" (CG-018).
 *
 * Two callers by design:
 *
 *   1. `shared--send-email`, which mirrors every non-auth scenario here AFTER
 *      the driver accepted the message — the same ordering discipline
 *      `notifyOneSigner` uses before it flips a signer's status. An in-app row
 *      therefore means a mail actually left, which is what `emailed` records.
 *   2. Anything with something to say and no mail to send — `envelope_completed`
 *      and friends. That second caller is the whole reason this is a shared
 *      module rather than a private function inside `shared--send-email`.
 *
 * NOTHING HERE THROWS. A notification is the least important thing happening in
 * any request that produces one: a failure to record "your document was signed"
 * must not roll back the signature, and it must never turn a 200 into a 500 for
 * an email that has already left and cannot be un-sent. Every failure is
 * swallowed, logged, and reported in the return value.
 */

import { createClient, type SupabaseClient } from "supabase";
import { requireEnv } from "./http.ts";

/** Mirrors `public.notifications_type_enum`. */
export type NotificationType =
    | "admin_invitation"
    | "organization_invitation"
    | "employee_onboarding_invitation"
    | "signature_request_invitation"
    | "signature_request_copy"
    | "signature_request_declined"
    | "signature_request_reminder"
    | "signature_request_expired"
    | "signature_request_changes_requested"
    | "envelope_completed"
    | "envelope_voided"
    | "envelope_signed_by_party"
    /**
     * CG-046. An outbound webhook endpoint was switched off after
     * CIRCUIT_BREAKER_THRESHOLD consecutive failures.
     *
     * The only value here that is not about a document. A silently disabled
     * endpoint is how an integration dies unnoticed — the fan-out simply stops
     * selecting it, so from that moment there is no outward sign at all, and the
     * customer finds out when their own system is a week stale.
     */
    | "webhook_endpoint_disabled";

/**
 * The optional block a mail caller attaches so its mirror can be routed.
 *
 * These are IDs the caller already holds — they are passed explicitly rather
 * than recovered from `payload.envelopeLink` with a regex, even for the two
 * scenarios where that would work today. Parsing a URL to get back a primary key
 * breaks the day `APP_URL` grows a path prefix.
 */
export type NotifyHints = {
    organizationId?: string | null;
    requestId?: string | null;
    /** App-relative. The database rejects anything that looks like a signing link. */
    link?: string | null;
    /** Override the derived copy when the caller knows better. */
    title?: string;
    body?: string;
    metadata?: Record<string, unknown>;
    /** Opt out of the mirror entirely for this send. */
    skip?: boolean;
};

export type NotifyResult =
    | { created: true; id: string }
    | {
          created: false;
          reason: "no_profile" | "skipped" | "not_mirrored" | "error";
          detail?: string;
      };

/**
 * Cached per isolate, exactly as `senderAuth`'s private client and
 * `getCronAdminClient` are. Lazy rather than module-scope on purpose: an eager
 * `requireEnv` at import time is what made `shared--send-email` 500 on load in a
 * fresh local stack with no mail credentials configured.
 */
let cachedAdmin: SupabaseClient | null = null;
export function getNotifyAdminClient(): SupabaseClient {
    cachedAdmin ??= createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    return cachedAdmin;
}

/**
 * email → `auth.users` id, via `profiles`.
 *
 * `null` for an external signer, and that is the ordinary case rather than a
 * failure: someone with no account has no inbox in this app.
 */
export async function resolveRecipientUserId(
    admin: SupabaseClient,
    email: string
): Promise<string | null> {
    const normalized = email.trim();
    if (!normalized) return null;

    // `ilike`, not `eq`: `profiles.email` is stored as the user typed it at
    // signup, while a signer's address arrives as whoever added them typed it.
    // The wildcards are escaped so an address containing `%` matches literally
    // rather than turning the lookup into a prefix scan over every profile.
    const escaped = normalized.replace(/[\\%_]/g, (c) => `\\${c}`);

    const { data: sb_FromProfiles_Select, error: sb_FromProfiles_SelectError } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", escaped)
        .maybeSingle();

    if (sb_FromProfiles_SelectError) {
        console.error("notify: profile lookup failed:", sb_FromProfiles_SelectError.message);
        return null;
    }
    return sb_FromProfiles_Select?.id ?? null;
}

export type CreateNotificationArgs = {
    /** Reuse the caller's service_role client when it has one; else the cached one. */
    admin?: SupabaseClient;
    /** One of `userId` / `email` is required. `userId` wins when both are given. */
    userId?: string | null;
    email?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    link?: string | null;
    organizationId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
    emailed?: boolean;
};

export async function createNotification(args: CreateNotificationArgs): Promise<NotifyResult> {
    try {
        const admin = args.admin ?? getNotifyAdminClient();

        const userId =
            args.userId ?? (args.email ? await resolveRecipientUserId(admin, args.email) : null);
        if (!userId) return { created: false, reason: "no_profile" };

        const { data: sb_FromNotifications_Insert, error: sb_FromNotifications_InsertError } =
            await admin
                .from("notifications")
                .insert({
                    user_id: userId,
                    organization_id: args.organizationId ?? null,
                    type: args.type,
                    title: args.title,
                    body: args.body ?? null,
                    link: args.link ?? null,
                    request_id: args.requestId ?? null,
                    metadata: args.metadata ?? {},
                    emailed: args.emailed ?? false,
                })
                .select("id")
                .single();

        if (sb_FromNotifications_InsertError) {
            console.error("notify: insert failed:", sb_FromNotifications_InsertError.message);
            return {
                created: false,
                reason: "error",
                detail: sb_FromNotifications_InsertError.message,
            };
        }
        return { created: true, id: sb_FromNotifications_Insert.id as string };
    } catch (err) {
        console.error("notify: unexpected failure:", err);
        return {
            created: false,
            reason: "error",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * The app-only path: tell an envelope's SENDER something that was never worth an
 * email.
 *
 * The sender is `signature_requests.created_by`, read here rather than passed
 * in, because the two callers that need it (`signing_submit`, `envelopes_void`)
 * both hold a request id and neither carries `created_by` on its context —
 * `SignerContext.request` and `SenderEnvelope` both select without it.
 *
 * `skipUserId` exists for the void case: an admin voiding their own document
 * does not need to be told they voided it, but an admin voiding a COLLEAGUE'S
 * document is exactly the case the notification is for.
 */
export async function notifyEnvelopeSender(args: {
    admin: SupabaseClient;
    requestId: string;
    organizationId: string;
    type: NotificationType;
    title: string;
    body?: string | null;
    metadata?: Record<string, unknown>;
    /** Do nothing when the sender is this user — usually the actor themselves. */
    skipUserId?: string | null;
}): Promise<NotifyResult> {
    try {
        const {
            data: sb_FromSignatureRequests_Select,
            error: sb_FromSignatureRequests_SelectError,
        } = await args.admin
            .from("signature_requests")
            .select("created_by")
            .eq("id", args.requestId)
            .maybeSingle();

        if (sb_FromSignatureRequests_SelectError) {
            console.error(
                "notify: could not resolve envelope sender:",
                sb_FromSignatureRequests_SelectError.message
            );
            return {
                created: false,
                reason: "error",
                detail: sb_FromSignatureRequests_SelectError.message,
            };
        }

        const createdBy = sb_FromSignatureRequests_Select?.created_by as string | null | undefined;
        if (!createdBy) return { created: false, reason: "no_profile" };
        if (args.skipUserId && createdBy === args.skipUserId)
            return { created: false, reason: "skipped" };

        return await createNotification({
            admin: args.admin,
            userId: createdBy,
            organizationId: args.organizationId,
            requestId: args.requestId,
            type: args.type,
            title: args.title,
            body: args.body ?? null,
            link: `/${args.organizationId}/envelopes/${args.requestId}`,
            metadata: args.metadata,
            emailed: false,
        });
    } catch (err) {
        console.error("notify: notifyEnvelopeSender failed:", err);
        return {
            created: false,
            reason: "error",
            detail: err instanceof Error ? err.message : String(err),
        };
    }
}

// --- Email scenario → notification ---

/**
 * The two auth scenarios have no mapping and never will: they reach someone who
 * is not signed in yet, so the bell they would land in is one the recipient
 * cannot open until after they have done the thing the mail asked for.
 */
// `signature_request_passcode` (CG-031) joins them for a different and stronger
// reason: it carries a LIVE CREDENTIAL. Mirroring it would copy a working
// passcode into a table the app reads and renders, where it would outlive the
// ten minutes the code is good for and be visible to anyone who can see the
// sender's bell. The recipient has no account to read a notification in anyway —
// not needing one is the entire point of the mode that sends this mail.
const NOT_MIRRORED = new Set(["auth_confirmation", "auth_recovery", "signature_request_passcode"]);

/** Templates put HTML in a few payload fields; a notification body is plain text. */
function stripTags(value: string | undefined): string | null {
    if (!value) return null;
    const text = value
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return text || null;
}

export type DerivedNotification = {
    type: NotificationType;
    title: string;
    body: string | null;
    link: string | null;
    organizationId: string | null;
    requestId: string | null;
    metadata: Record<string, unknown>;
};

/**
 * Maps a sent email onto the row it should mirror to, or `null` when the
 * scenario is deliberately not mirrored.
 *
 * NOTE ON LINKS. `payload.signingLink` and `payload.documentLink` are
 * `/sign/<plaintext-token>` URLs and are NEVER used here — the link always comes
 * from `hints.link`, which callers build from ids. The database enforces this
 * independently (`notifications_link_is_not_a_signing_link`); this is the first
 * of the two gates, not the only one.
 *
 * NOTE ON REASONS. `declineReason` and `changesReason` are copied verbatim.
 * Both are hashed into the audit chain, so a paraphrase here would make the bell
 * and the evidence disagree about what was said.
 */
export function deriveNotificationFromEmail(
    scenario: string,
    payload: Record<string, string>,
    hints?: NotifyHints
): DerivedNotification | null {
    if (NOT_MIRRORED.has(scenario)) return null;

    const base = {
        organizationId: hints?.organizationId ?? null,
        requestId: hints?.requestId ?? null,
        link: hints?.link ?? null,
        metadata: hints?.metadata ?? {},
    };

    let derived: DerivedNotification | null = null;

    switch (scenario) {
        case "admin_invitation":
            derived = {
                ...base,
                type: "admin_invitation",
                title: `You've been invited to join ${payload.orgName}`,
                body: `You've been invited to administer ${payload.orgName} on ContractGo.`,
            };
            break;

        // CG-020. The role is in the copy rather than in the type, so one enum
        // value serves both tiers and adding a third later is a payload change
        // rather than a migration.
        case "organization_invitation":
            derived = {
                ...base,
                type: "organization_invitation",
                title: `You've been invited to join ${payload.orgName}`,
                body: `You've been invited to join ${payload.orgName} on ContractGo as ${payload.roleArticle ?? "a"} ${payload.roleLabel}.`,
            };
            break;

        case "employee_onboarding_invitation":
            derived = {
                ...base,
                type: "employee_onboarding_invitation",
                title: `${payload.orgName} invited you to complete onboarding`,
                body: null,
            };
            break;

        case "signature_request_invitation":
            derived = {
                ...base,
                type: "signature_request_invitation",
                title: `${payload.orgName} requests your signature on ${payload.documentTitle}`,
                body: "You have been asked to review and sign this document.",
            };
            break;

        case "signature_request_copy":
            derived = {
                ...base,
                type: "signature_request_copy",
                title: `Copy: ${payload.documentTitle}`,
                body: stripTags(payload.introLine),
            };
            break;

        case "signature_request_declined":
            derived = {
                ...base,
                type: "signature_request_declined",
                title: `${payload.signerName} declined to sign ${payload.documentTitle}`,
                body: payload.declineReason ?? null,
                metadata: {
                    ...base.metadata,
                    signer_email: payload.signerEmail,
                    signer_name: payload.signerName,
                },
            };
            break;

        case "signature_request_reminder":
            derived = {
                ...base,
                type: "signature_request_reminder",
                title: `Still waiting on your signature: ${payload.documentTitle}`,
                body: stripTags(payload.deadlineLine),
                metadata: { ...base.metadata, sent_on: payload.sentOn },
            };
            break;

        case "signature_request_expired":
            derived = {
                ...base,
                type: "signature_request_expired",
                title: `${payload.documentTitle} expired`,
                body: payload.outstanding ? `Still outstanding: ${payload.outstanding}` : null,
                metadata: { ...base.metadata, expired_on: payload.expiredOn },
            };
            break;

        case "signature_request_changes_requested":
            derived = {
                ...base,
                type: "signature_request_changes_requested",
                title: `${payload.orgName} asked for changes to ${payload.documentTitle}`,
                body: payload.changesReason ?? null,
            };
            break;

        default:
            // An unknown scenario is not an error — it is a scenario added to the
            // registry without a mapping here, and a missing bell entry is a far
            // better outcome than a failed send.
            console.warn(`notify: no notification mapping for scenario "${scenario}"`);
            return null;
    }

    if (hints?.title) derived.title = hints.title;
    if (hints?.body !== undefined) derived.body = hints.body;

    return derived;
}

/**
 * The whole mirror, in one best-effort call. Used by `shared--send-email` on
 * both driver paths.
 */
export async function mirrorEmailToNotification(
    scenario: string,
    to: string,
    payload: Record<string, string>,
    hints?: NotifyHints
): Promise<NotifyResult> {
    if (hints?.skip) return { created: false, reason: "skipped" };

    const derived = deriveNotificationFromEmail(scenario, payload, hints);
    if (!derived) return { created: false, reason: "not_mirrored" };

    return await createNotification({ ...derived, email: to, emailed: true });
}
