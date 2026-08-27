/**
 * Everything that turns a TEMPLATE plus a list of people into the rows of a
 * signature request — shared by the three functions that need to agree about it.
 *
 * WHY THIS MODULE EXISTS NOW AND DID NOT BEFORE. Until Phase G there was exactly
 * one way a `signature_requests` row came into being (`envelopes_send`), so all
 * of this lived inside it. Drafts add two more entry points, and the plan is
 * explicit that promotion must **re-validate against the pinned version at
 * promotion, not at draft time**. Three copies of the validation would be three
 * chances for a draft to be saveable and then unsendable for a reason the save
 * did not mention — or worse, sendable through one path and not the other.
 *
 * THE ONE RULE THAT SHAPES THE WHOLE FILE: the client never asserts its own
 * document's identity. `source_pdf_sha256` is NOT NULL and it is EVIDENCE — it is
 * what proves months later that the document burned is the document sent. So the
 * digest is always computed here, from bytes this server read out of storage,
 * which is why a draft cannot be a client-side insert and why
 * `envelopes_draft_create` is an edge function rather than a `useM_*` writing
 * through PostgREST.
 *
 * TWO STRICTNESSES, deliberately. A draft is a saved INTENT and may be
 * half-finished — that is what a draft is for. A send is a promise to real people
 * that a real document is coming. So `validateForDraft` accepts almost anything
 * that can be stored, and `validateForSend` is the full gate; nothing may reach
 * `in_progress` without passing the second.
 */

import type { SupabaseClient } from "supabase";
import { sha256Bytes } from "./http.ts";
import { getStorageDriver } from "./storage.ts";
import { SenderAuthError } from "./senderAuth.ts";

// ============================================================
// Shapes
// ============================================================

export type SnapshotField = {
    id: string;
    key: string;
    label: string;
    type: string;
    role_id: string;
    required: boolean;
    options?: { label: string; value: string }[];
    default_value?: string;
    read_only?: boolean;
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
};

export type SignerRole = { id: string; name: string; order: number; color: string };

/**
 * A party on the envelope. Two kinds, and the difference is structural rather
 * than a flag on one shape (CG-011):
 *
 *   signer — fulfils exactly one template ROLE, whose `order` decides when they
 *            are reached. `UNIQUE (request_id, role_id)` enforces the one-person-
 *            per-role rule the database could not back before CG-011.
 *   cc     — an observer. No role, no turn: pinned to `signer_order = 0`, which
 *            `signature_requests.current_order >= 1` can never equal, so
 *            `signature_claim_turn` cannot match them. Receives a `view` token.
 */
export type RecipientInput = {
    /** Required for `signer`, and must be absent for `cc`. */
    role_id?: string | null;
    recipient_type?: "signer" | "cc";
    name: string;
    email: string;
    /**
     * Optional. Persisted to `signature_request_signers.signer_phone` and snapshot
     * into every audit entry this person is the actor of (CG-016) — the trail is
     * required to identify a performer by name, email AND phone where it is known.
     * Also the number an SMS OTP will use when that driver lands (v1.2.0).
     */
    phone?: string | null;
    /**
     * CC only. Observers are copied on COMPLETION by default — the finished
     * document is the artifact worth observing — and this asks for a copy at send
     * time as well. Deliberately not persisted: once the mail has left, nothing
     * downstream needs to remember the choice.
     */
    notify_on_send?: boolean;
    /**
     * SIGNER ONLY. This recipient's exception to the envelope-level
     * `signer_auth` (CG-032). `undefined` or `null` means INHERIT, which is what
     * every existing client sends and what the composer stores unless the sender
     * explicitly excepted this person.
     *
     * Clamped to `null` for a `cc` in `buildSignerRows` rather than validated:
     * `signature_request_signers_auth_method_check` refuses it in the database,
     * and a client bug should be a null rather than a constraint-name 500 — the
     * same treatment `role_id` gets one line above.
     */
    auth_method?: SignerAuth | null;
    /**
     * [ekyc] SIGNER ONLY. This recipient's exception to the envelope-level
     * `require_identity_check` (CG-033). `undefined` or `null` means INHERIT.
     * Clamped to `null` for a `cc` in `buildSignerRows`, same as `auth_method`.
     */
    require_identity_check?: boolean | null;
};

/** The body shape every compose entry point accepts. */
export type ComposeBody = {
    organization_id: string;
    // No `entity_id`. It was accepted here and written straight onto the row by a
    // service-role client, with nothing checking that the id belonged to the
    // caller's organization — the one field on this body that skipped the
    // organization scoping `resolveTemplateAndVersion` applies to everything else.
    // CG-030 made the entity something only the database names: it is derived
    // from the resolved template below, which IS org-scoped.
    template_id: string;
    title?: string;
    recipients?: RecipientInput[];
    /** Sender-role values, keyed by `TemplateField.id`. */
    prefilled_values?: Record<string, unknown>;
    /**
     * When this stops being signable. THREE-WAY, and the difference matters:
     * `undefined` takes the pinned version's `default_expiry_days`, an explicit
     * `null` means the sender chose "never", and a string is their own date. A
     * two-way flag could not express "I deliberately want no deadline on this
     * one" against a template that has a default.
     */
    expires_at?: string | null;
    /** Offsets in days since sending. `undefined` takes the version's default. */
    reminder_days?: number[];
    /**
     * How recipients prove who they are before signing (CG-031). `undefined`
     * means 'account' — see `resolveSignerAuth`.
     *
     * Unlike `expires_at` there is no three-way here and no template default to
     * fall back to: this is a property of the SEND, the template has no opinion
     * about it, and the two values are exhaustive.
     */
    signer_auth?: SignerAuth;
    /**
     * [ekyc] Whether recipients must pass a government-ID check before signing
     * (CG-033). `undefined` means `false` — see `resolveRequireIdentityCheck`.
     *
     * ORTHOGONAL to `signer_auth`, not an alternative to it: a recipient can owe
     * a passcode, a document check, both, or neither.
     */
    require_identity_check?: boolean;
};

/** Mirrors `signature_requests_signer_auth_enum`. */
export type SignerAuth = "account" | "email_otp";

/**
 * Resolves the sender's identity-requirement choice, defaulting to the stricter
 * one.
 *
 * FAILS CLOSED IN BOTH DIRECTIONS. A missing value means 'account', so an older
 * client — or a draft saved before CG-031 — sends the way it always did rather
 * than silently downgrading a document to passcode signing. An unrecognised
 * value is REFUSED rather than coerced, because "we did not understand what you
 * asked for, so we picked one" is the wrong answer about an authentication
 * setting; and refusing here produces a sentence the sender can read instead of
 * a Postgres enum-constraint error surfacing as a 500.
 *
 * CG-050 added the ORG DEFAULT as the middle rung: explicit body > organization
 * > 'account'. It is a parameter with a default rather than a lookup inside this
 * function, so the function stays pure and every existing call — and the whole
 * existing test file — keeps its meaning unchanged. The org's value comes free
 * on `ctx.organization`, widened out of a select that already ran.
 *
 * Note the org default does NOT weaken the fail-closed rule below it: an org
 * that never chose still resolves to 'account', because that column's own
 * database default is 'account'.
 *
 * Pure, so it is unit-testable without a client — see
 * `tests/unit/edge/envelopeCompose.signerAuth.test.ts`.
 */
export function resolveSignerAuth(
    body: ComposeBody,
    orgDefault: SignerAuth = "account"
): SignerAuth {
    const value = body.signer_auth;
    if (value === undefined || value === null) return orgDefault;
    if (value === "account" || value === "email_otp") return value;
    throw new Error(
        `Unknown signer_auth ${JSON.stringify(value)}. Expected "account" or "email_otp".`
    );
}

/**
 * The same discipline as `resolveSignerAuth`, one level down: per RECIPIENT.
 *
 * THE DEFAULT IS DIFFERENT AND MUST BE. `resolveSignerAuth` defaults to
 * 'account' because an absent envelope-level choice has to resolve to the
 * stricter of the two. Here an absent value means INHERIT — `null` — because
 * the envelope-level choice is the thing being inherited and has already had
 * that rule applied to it. Defaulting to 'account' here would silently override
 * every recipient on every `email_otp` envelope any existing client sends.
 *
 * An unrecognised value is REFUSED rather than coerced, for exactly the reason
 * `resolveSignerAuth` gives: "we did not understand what you asked for, so we
 * picked one" is the wrong answer about an authentication setting.
 *
 * Pure and unit-tested beside its sibling in
 * `tests/unit/edge/envelopeCompose.signerAuth.test.ts`.
 */
export function resolveRecipientAuth(recipient: RecipientInput): SignerAuth | null {
    const value = recipient.auth_method;
    if (value === undefined || value === null) return null;
    if (value === "account" || value === "email_otp") return value;
    throw new Error(
        `Unknown recipient auth_method ${JSON.stringify(value)}. Expected "account", "email_otp" or null.`
    );
}

/**
 * [ekyc] The envelope-level identity requirement — CG-033.
 *
 * THE DEFAULT IS `false`, AND THAT IS NOT THE SAME KIND OF DEFAULT AS
 * `resolveSignerAuth`'s. That one defaults to the STRICTER option because
 * "we could not tell" must not weaken a signature. Here "we could not tell" must
 * resolve to NOT REQUIRED, because an identity check nobody asked for is a wall
 * in front of a contract — and because every client that predates CG-033 omits
 * the key entirely, so any other default would retroactively gate every send.
 *
 * A NON-BOOLEAN THROWS rather than being coerced, matching `resolveSignerAuth`'s
 * discipline: "we did not understand what you asked for, so we picked one" is
 * the wrong answer about an authentication setting, in either direction.
 */
export function resolveRequireIdentityCheck(body: ComposeBody): boolean {
    const value = body.require_identity_check;
    if (value === undefined || value === null) return false;
    if (typeof value !== "boolean") {
        throw new Error(
            `Unknown require_identity_check ${JSON.stringify(value)}. Expected true or false.`
        );
    }
    return value;
}

/** [ekyc] The per-recipient override. `null` is INHERIT, as everywhere else. */
export function resolveRecipientIdentityCheck(recipient: RecipientInput): boolean | null {
    const value = recipient.require_identity_check;
    if (value === undefined || value === null) return null;
    if (typeof value !== "boolean") {
        throw new Error(
            `Unknown recipient require_identity_check ${JSON.stringify(value)}. Expected true, false or null.`
        );
    }
    return value;
}

export const isCc = (recipient: RecipientInput): boolean => recipient.recipient_type === "cc";

/** CC rows sit here, where no `current_order` can reach them. */
export const CC_SIGNER_ORDER = 0;

/**
 * A role with `order = 0` is the SENDER: the party composing the envelope, who
 * fills their fields at compose time and never receives a link. CG-001 seeds every
 * pre-existing template with exactly this shape (`rol_sender` at order 0), and the
 * builder's role manager preserves it.
 */
export const SENDER_ROLE_ORDER = 0;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// Resolving the template
// ============================================================

export type ResolvedTemplate = {
    template: { id: string; name: string; entity_id: string | null };
    version: {
        id: string;
        version_number: number;
        pdf_file_path: string;
        default_expiry_days: number | null;
        default_reminder_days: number[];
    };
    layout: SnapshotField[];
    signerRoles: SignerRole[];
};

/**
 * Loads the template and PINS ITS LATEST VERSION.
 *
 * The template row is never read for content — only for its name, entity and
 * kind. Pinning the latest VERSION is what makes "what was sent" a fixed fact: a
 * colleague can save the builder a second later and the request is unaffected,
 * because its snapshot came from an immutable row.
 *
 * Called at draft time AND again at promotion, and it deliberately resolves the
 * latest version each time. A draft is an intent, not a frozen document: if the
 * template moved on between saving and sending, the sender sends the CURRENT
 * document — and `validateForSend` is what refuses when their saved recipients or
 * pre-filled values no longer fit it, with a message naming the mismatch.
 */
export async function resolveTemplateAndVersion(
    admin: SupabaseClient,
    organizationId: string,
    templateId: string
): Promise<ResolvedTemplate> {
    const { data: template, error: templateError } = await admin
        .from("contract_templates")
        .select("id, name, entity_id, organization_id, type")
        .eq("id", templateId)
        .eq("organization_id", organizationId)
        .maybeSingle();

    if (templateError) {
        console.error("resolveTemplateAndVersion: template lookup failed:", templateError);
        throw new SenderAuthError(500, "Could not load the template");
    }
    if (!template) throw new SenderAuthError(404, "Template not found in this organization");
    if (template.type !== "pdf") {
        throw new SenderAuthError(
            400,
            "Only PDF templates can be sent. This template is a retired kind."
        );
    }

    const { data: version, error: versionError } = await admin
        .from("contract_template_versions")
        .select(
            "id, version_number, type, layout, pdf_file_path, signer_roles, default_expiry_days, default_reminder_days"
        )
        .eq("template_id", templateId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (versionError) {
        console.error("resolveTemplateAndVersion: version lookup failed:", versionError);
        throw new SenderAuthError(500, "Could not load the template version");
    }
    if (!version) {
        throw new SenderAuthError(
            409,
            "This template has no saved version yet. Open it in the builder and save."
        );
    }
    if (!version.pdf_file_path) {
        throw new SenderAuthError(
            409,
            "This template version has no source PDF. Upload one in the builder."
        );
    }

    return {
        template: {
            id: template.id as string,
            name: template.name as string,
            entity_id: (template.entity_id ?? null) as string | null,
        },
        version: {
            id: version.id as string,
            version_number: version.version_number as number,
            pdf_file_path: version.pdf_file_path as string,
            default_expiry_days: (version.default_expiry_days ?? null) as number | null,
            default_reminder_days: (version.default_reminder_days ?? []) as number[],
        },
        layout: Array.isArray(version.layout) ? (version.layout as unknown as SnapshotField[]) : [],
        signerRoles: Array.isArray(version.signer_roles)
            ? (version.signer_roles as unknown as SignerRole[])
            : [],
    };
}

/**
 * Reads the source PDF and hashes it.
 *
 * Read through the driver rather than trusting the template row: the digest has
 * to describe bytes that actually exist and are actually fetchable, or the first
 * thing to discover otherwise is a signer staring at a broken document. A draft
 * pays this cost too — `source_pdf_sha256` is NOT NULL, so there is no such thing
 * as a draft that has not been hashed.
 */
export async function hashSourcePdf(pdfFilePath: string): Promise<string> {
    try {
        const bytes = await getStorageDriver().getObject(pdfFilePath);
        return await sha256Bytes(bytes);
    } catch (err) {
        console.error("Could not read template PDF:", err);
        throw new SenderAuthError(502, "The template's source PDF could not be read from storage.");
    }
}

/**
 * The self-sufficiency copy. Everything needed to render, validate and burn is
 * copied in, so hard-deleting the template tomorrow leaves the request intact
 * (AHR-1487/1490/1954).
 */
export function buildSnapshot(resolved: ResolvedTemplate): Record<string, unknown> {
    return {
        type: "pdf",
        layout_version: 2,
        layout: resolved.layout,
        pdf_file_path: resolved.version.pdf_file_path,
        signer_roles: resolved.signerRoles,
    };
}

/**
 * The `signature_requests` row an ENVELOPE IS SENT AS — the shape both send
 * paths write.
 *
 * CG-044 gave the product a second way to send a document (the public API), and
 * a second literal describing the same row is a divergence waiting to happen:
 * add a column to one and nothing fails until a document sent the other way is
 * missing it, weeks later, in production.
 *
 * ⚠ THE ASYMMETRY IS REAL AND IS NOT AN OVERSIGHT. `envelopes_send` still
 * builds this literal INLINE — v1.4.0 was additive-only and that function is on
 * the untouched list — so the two agree by review plus
 * `envelopeCompose.requestRow.test.ts`, which pins the exact key set. That
 * catches a field added HERE and not to `envelopes_send`; it cannot catch the
 * reverse. When `envelopes_send` is next legitimately touched, switch it to call
 * this and the asymmetry goes away.
 *
 * EVERY SCHEDULE AND AUTH VALUE IS TAKEN AS GIVEN, never re-read from
 * `resolved.version.default_*`. They are absolute facts about THIS send: a
 * template corrected next week must not retroactively change this document's
 * deadline or how it may be signed.
 */
export function buildRequestRow(args: {
    body: ComposeBody;
    resolved: ResolvedTemplate;
    schedule: ResolvedSchedule;
    signerAuth: SignerAuth;
    /** [ekyc] Resolved by the caller, for the same reason `signerAuth` is. */
    requireIdentityCheck: boolean;
    sourcePdfSha256: string;
    sentAt: Date;
}): Record<string, unknown> {
    const { body, resolved, schedule } = args;

    return {
        organization_id: body.organization_id,
        entity_id: resolved.template.entity_id,
        template_id: body.template_id,
        // THE VERSION, not the template. The self-sufficiency invariant's anchor:
        // what was sent is a fixed fact even if the template is edited a second
        // later, or hard-deleted (AHR-1487/1490/1954).
        template_version_id: resolved.version.id,
        title: body.title!.trim(),
        source_pdf_r2_key: resolved.version.pdf_file_path,
        source_pdf_sha256: args.sourcePdfSha256,
        template_snapshot: buildSnapshot(resolved),
        // Defaulted to `{}` rather than left null: this column is the BASE LAYER
        // of the burn merge, and a null would make `finalizeRequest` merge
        // against nothing instead of against "the sender filled nothing".
        prefilled_values: (body.prefilled_values ?? {}) as Record<string, unknown>,
        status: "in_progress" as const,
        sent_at: args.sentAt.toISOString(),
        expires_at: schedule.expiresAt,
        reminder_days: schedule.reminderDays,
        signer_auth: args.signerAuth,
        require_identity_check: args.requireIdentityCheck, // [ekyc]
    };
}

// ============================================================
// Recipient rows
// ============================================================

export type SignerRowInput = {
    request_id: string;
    organization_id: string;
    recipient_type: "signer" | "cc";
    role_id: string | null;
    signer_order: number;
    signer_email: string;
    signer_name: string;
    /** Identification evidence for this party (CG-016). Optional to give. */
    signer_phone: string | null;
    /** NULL means inherit `signature_requests.signer_auth` (CG-032). */
    auth_method: SignerAuth | null;
    /** [ekyc] NULL means inherit `signature_requests.require_identity_check`. */
    require_identity_check: boolean | null;
    signer_user_id: null;
    status: "pending";
};

/**
 * A recipient nobody has typed anything into. The composer's "Add observer"
 * button leaves one behind by design, and a role card starts empty, so these are
 * normal rather than erroneous — they are dropped instead of stored.
 */
export const isEmptyRecipient = (recipient: RecipientInput): boolean =>
    !recipient?.name?.trim() && !recipient?.email?.trim();

/**
 * Turns recipients into rows.
 *
 * `signature_request_signers_recipient_shape_check` (CG-011) is the authority on
 * the two shapes: a signer MUST carry a role and an order >= 1, a cc MUST carry
 * neither a role nor a turn. Building both from one map with a branch keeps the
 * two readings of the constraint in one place.
 *
 * A HALF-TYPED RECIPIENT IS STORED, with `signer_email` as the empty string.
 * `signer_email`/`signer_name` are NOT NULL but not non-empty, and a draft that
 * silently discarded the party whose address the sender had not looked up yet
 * would lose exactly the work a draft exists to keep. It is safe because nothing
 * mails a signer on a `draft` request — `notifySignersAtOrder` is only ever
 * reached from a send or from routing, both of which require `in_progress` — and
 * because `validateForSend` runs `EMAIL_PATTERN` over every recipient at
 * promotion, so a blank can be saved forever and sent never.
 */
export function buildSignerRows(args: {
    requestId: string;
    organizationId: string;
    recipients: RecipientInput[];
    signerRoles: SignerRole[];
}): SignerRowInput[] {
    const roleById = new Map(args.signerRoles.map((role) => [role.id, role]));

    return args.recipients
        .filter((r) => !isEmptyRecipient(r))
        .map((recipient) => ({
            request_id: args.requestId,
            organization_id: args.organizationId,
            recipient_type: isCc(recipient) ? ("cc" as const) : ("signer" as const),
            role_id: isCc(recipient) ? null : recipient.role_id!,
            signer_order: isCc(recipient)
                ? CC_SIGNER_ORDER
                : (roleById.get(recipient.role_id!)?.order ?? 1),
            signer_email: recipient.email.toLowerCase().trim(),
            signer_name: recipient.name.trim(),
            // Trimmed but otherwise verbatim, and NULL rather than '' when absent: an
            // empty string in an audit payload reads as "recorded as blank" where the
            // truth is "the sender did not have it". Format normalization belongs to
            // the OTP driver that will dial it, not here — see the CG-016 migration.
            signer_phone: recipient.phone?.trim() || null,
            // Clamped for a CC the same way `role_id` is, and for the same reason:
            // an observer never authenticates — `assertCanAct` refuses their `view`
            // token before the identity gate is reached — so a setting stored on one
            // would be a control the server can never honour.
            auth_method: isCc(recipient) ? null : resolveRecipientAuth(recipient),
            // [ekyc] Clamped for the same reason and by the same rule.
            require_identity_check: isCc(recipient)
                ? null
                : resolveRecipientIdentityCheck(recipient),
            // No `auth.users` lookup. An external signer needs no account (CG-005),
            // and linking one that happens to share the email would silently change
            // who the audit trail names.
            signer_user_id: null,
            status: "pending" as const,
        }));
}

/**
 * The order the request starts at.
 *
 * The MINIMUM SIGNER order, not the minimum recipient order. Two things would
 * break a naive min over every recipient: a CC sits at order 0, which
 * `signature_requests_current_order_check (>= 1)` rejects outright, and roles may
 * now share an order (CG-011), so "first" is a batch rather than a person.
 */
export function firstSignerOrder(rows: SignerRowInput[]): number {
    const orders = rows.filter((r) => r.recipient_type === "signer").map((r) => r.signer_order);
    // Drafts legitimately have no signers yet, and `current_order` is NOT NULL
    // with a CHECK of >= 1. Nothing reads it while the status is `draft` —
    // `signature_claim_turn` requires `in_progress` — so 1 is a placeholder that
    // promotion always overwrites, never a routing claim.
    return orders.length > 0 ? Math.min(...orders) : 1;
}

// ============================================================
// Validation — the lax half
// ============================================================

/**
 * What a DRAFT must satisfy: only the things without which a row cannot be
 * stored or later resumed.
 *
 * Deliberately silent about the things a send insists on — missing emails,
 * uncovered roles, unfilled sender fields. A draft is a saved intent, and a save
 * that refuses because the sender has not decided who the second signer is yet
 * has misunderstood what the button is for.
 *
 * @returns an error sentence, or null.
 */
export function validateForDraft(body: ComposeBody): string | null {
    if (!body?.organization_id) return "organization_id is required";
    // The one hard requirement, and it follows from the schema rather than from
    // taste: `source_pdf_sha256` is NOT NULL, so a draft with no template has no
    // bytes to hash and cannot exist as a row.
    if (!body?.template_id) return "Pick a document before saving a draft";

    for (const recipient of body.recipients ?? []) {
        if (isEmptyRecipient(recipient)) continue;
        // A cc carrying a role would fail the CG-011 shape CHECK with a
        // constraint name instead of a sentence. This is a client bug rather
        // than a sender mistake, so it is refused at both strictnesses.
        if (isCc(recipient)) {
            if (recipient.role_id) return "A copied recipient cannot be assigned a role";
        } else if (!recipient.role_id) {
            return "Every signer must be assigned a role";
        }
    }
    return null;
}

// ============================================================
// Validation — the strict half
// ============================================================

/**
 * Everything a SEND insists on, checked against the PINNED VERSION.
 *
 * Every one of these is re-checked here even though the composer enforces them
 * in the UI, and at PROMOTION even though `envelopes_draft_create` saw an earlier
 * version of the same data. The composer validates against the template's CURRENT
 * layout and a draft was validated against whatever the layout was that day;
 * this validates against the version that will actually be signed, which is the
 * one that decides.
 *
 * @returns a structured payload for a 400 (the composer highlights
 *          `missing_fields` by id), or null.
 */
export function validateForSend(args: {
    body: ComposeBody;
    layout: SnapshotField[];
    signerRoles: SignerRole[];
}): Record<string, unknown> | null {
    const { body, layout, signerRoles } = args;
    const recipients = (body.recipients ?? []).filter((r) => !isEmptyRecipient(r));

    if (!body?.title?.trim()) return { error: "A document title is required" };
    if (recipients.length === 0) return { error: "At least one recipient is required" };

    for (const recipient of recipients) {
        if (!recipient?.name?.trim()) return { error: "Every recipient needs a name" };
        if (!EMAIL_PATTERN.test(recipient?.email?.trim() ?? "")) {
            return { error: `"${recipient?.email ?? ""}" is not a valid email address` };
        }
        if (isCc(recipient)) {
            if (recipient.role_id) {
                return { error: "A copied recipient cannot be assigned a role" };
            }
        } else if (!recipient.role_id) {
            return { error: "Every signer must be assigned a role" };
        }
    }

    // A request with only observers can never progress: `current_order` would
    // have no order to take, and nobody could sign. The one recipient rule that
    // is about the SET rather than about a row.
    if (recipients.every(isCc)) {
        return { error: "At least one signer is required — copied recipients cannot sign" };
    }

    const roleById = new Map(signerRoles.map((role) => [role.id, role]));
    const signingParties = recipients.filter((r) => !isCc(r));

    for (const recipient of signingParties) {
        if (!roleById.has(recipient.role_id!)) {
            return {
                error: "This template changed while you were composing. Reopen it and try again.",
                unknown_role_id: recipient.role_id,
            };
        }
        if (roleById.get(recipient.role_id!)!.order === SENDER_ROLE_ORDER) {
            return {
                error: "The sender role is filled by you and cannot be assigned a recipient.",
            };
        }
    }

    // One recipient per ROLE — no longer an application rule the database cannot
    // back. CG-011 swapped `UNIQUE (request_id, signer_order)` for
    // `UNIQUE (request_id, role_id)`, which is exactly this check as an
    // invariant. Two people on one role would write the same positioned boxes
    // and sign into the same rectangle, and there is no non-arbitrary answer to
    // who wins; N parties are expressed as N ROLES.
    //
    // Note what is deliberately NOT checked: that each role's `order` is
    // distinct. Roles sharing an order is the point of v1.1 — they sign in
    // parallel, and `signature_advance_after_signature` holds the request at that
    // order until all of them are done.
    const seenRoles = new Set<string>();
    for (const recipient of signingParties) {
        if (seenRoles.has(recipient.role_id!)) {
            return { error: "Each role can have only one recipient." };
        }
        seenRoles.add(recipient.role_id!);
    }

    // Every role the template actually USES must be covered, or the document can
    // never complete: its required fields would have no one able to fill them and
    // routing would advance past an order with no signers at it.
    const assignedRoles = new Set(signingParties.map((r) => r.role_id));
    const uncovered = [...new Set(layout.map((f) => f.role_id))]
        .filter((roleId) => {
            const role = roleById.get(roleId);
            return role && role.order !== SENDER_ROLE_ORDER && !assignedRoles.has(roleId);
        })
        .map((roleId) => roleById.get(roleId)!.name);

    if (uncovered.length > 0) {
        return {
            error: `These roles have fields but no recipient: ${uncovered.join(", ")}`,
            uncovered_roles: uncovered,
        };
    }

    const senderRoleIds = new Set(
        signerRoles.filter((r) => r.order === SENDER_ROLE_ORDER).map((r) => r.id)
    );

    // A signature box on the SENDER role has no way to be filled: the sender
    // never opens the signing surface, which is the only place a signature is
    // captured. Rejecting it with a specific message beats letting it fall
    // through to "fill your required fields" for a field that cannot be filled.
    const senderSignatureFields = layout
        .filter((f) => senderRoleIds.has(f.role_id))
        .filter((f) => f.type === "signature" || f.type === "initials")
        .map((f) => f.label);

    if (senderSignatureFields.length > 0) {
        return {
            error:
                `The sender role carries signature fields (${senderSignatureFields.join(", ")}), ` +
                "which cannot be signed from the composer. Reassign them to a signing role in the builder.",
        };
    }

    // Sender-role required fields must be filled BEFORE sending. The signer sees
    // them locked and read-only, so an empty one is a blank they cannot fix.
    const prefilled = (body.prefilled_values ?? {}) as Record<string, unknown>;
    const missing = layout
        .filter((f) => senderRoleIds.has(f.role_id) && f.required)
        .filter((f) => {
            const value = prefilled[f.id];
            return value === undefined || value === null || value === "" || value === false;
        })
        .map((f) => ({ id: f.id, label: f.label }));

    if (missing.length > 0) {
        return { error: "Fill your own required fields before sending.", missing_fields: missing };
    }

    return null;
}

// ============================================================
// Schedule
// ============================================================

export type ResolvedSchedule = {
    /** ISO instant, or null for "never expires". */
    expiresAt: string | null;
    /** Positive whole days since sending, deduped and ascending. */
    reminderDays: number[];
};

/** A year. Long enough for any real contract, short enough to catch a typo'd year. */
const MAX_EXPIRY_DAYS = 365;

/**
 * Turns the sender's choices plus the pinned version's defaults into the two
 * columns the schedulers read.
 *
 * Throws rather than returning an error object because every failure here is one
 * sentence about one field — unlike `validateForSend`, which returns structured
 * detail the composer uses to highlight specific boxes.
 *
 * `strict` is false when saving a DRAFT, and this is the one place where the two
 * strictnesses differ for a reason other than "a draft is unfinished": a draft's
 * stored deadline is an ABSOLUTE instant, so a draft that sits for a month has a
 * deadline in the past through no fault of the data. Refusing to SAVE it would
 * trap the sender's own draft; refusing to SEND it is right, and promotion says
 * exactly that. The relative checks (whole positive days) apply either way,
 * because a malformed offset is malformed whenever it was typed.
 *
 * The strict rules, each of which exists because of a way a schedule can be
 * silently useless rather than wrong:
 *
 *  - an expiry in the past would be picked up by the very next `cron_expire` tick
 *    and close the document within the hour, having emailed everyone first;
 *  - a reminder offset at or past the expiry never fires, because the expiry job
 *    runs first and the reminder job skips anything not `in_progress` — a schedule
 *    that looks set and does nothing is worse than one that was refused;
 *  - duplicates would each be "due" at the same instant and only the latest of a
 *    tie fires, so they are collapsed here rather than left to surprise someone
 *    reading the column.
 */
/**
 * Folds the ORG's house defaults in under the template version's (CG-050).
 *
 * Precedence, and every rung is deliberate:
 *
 *   expiry     body (incl. explicit null = never) > version > ORG > never
 *   reminders  body (incl. explicit [] = none)    > version IF NON-EMPTY > ORG > {}
 *
 * `resolveSchedule` itself does NOT change — only what is handed to it. That
 * matters: it is the function with the clock rules and the stranded-reminder
 * check in it, and CG-013's reasoning about those is untouched by adding a
 * fallback one level up.
 *
 * ═══ WHY REMINDERS SAY "IF NON-EMPTY" AND EXPIRY DOES NOT ═══
 *
 * `contract_template_versions.default_expiry_days` is NULLABLE, so a version can
 * say "I have no opinion" and the org is asked next. `default_reminder_days` is
 * `NOT NULL DEFAULT '{}'` (CG-013), so it CANNOT distinguish "never configured"
 * from "explicitly no reminders" — every version ever created has `{}` unless
 * someone typed something.
 *
 * Treating `{}` as "no opinion" is therefore the only reading that makes an org
 * default reachable at all, and it is resolved toward inheritance on purpose. It
 * does cost one thing: a template author cannot express "this template
 * specifically should never remind" while the org does. A sender can still do it
 * per-envelope with an explicit `reminder_days: []`, which outranks everything
 * here. If that limitation ever actually bites, the fix is dropping the NOT NULL
 * — which means touching the template Insert types and CG-039's version-copy
 * trigger, and is not worth doing speculatively.
 */
export function mergeScheduleDefaults(
    version: { default_expiry_days: number | null; default_reminder_days: number[] },
    organization?: { default_expiry_days: number | null; default_reminder_days: number[] }
): { defaultExpiryDays: number | null; defaultReminderDays: number[] } {
    return {
        defaultExpiryDays: version.default_expiry_days ?? organization?.default_expiry_days ?? null,
        defaultReminderDays:
            version.default_reminder_days.length > 0
                ? version.default_reminder_days
                : (organization?.default_reminder_days ?? []),
    };
}

export function resolveSchedule(
    body: ComposeBody,
    defaults: {
        defaultExpiryDays: number | null;
        defaultReminderDays: number[];
        sentAt: Date;
        strict: boolean;
    }
): ResolvedSchedule {
    let expiresAt: string | null = null;
    if (body.expires_at === undefined) {
        const days = defaults.defaultExpiryDays;
        if (days !== null && Number.isFinite(days) && days > 0) {
            expiresAt = new Date(
                defaults.sentAt.getTime() + days * 24 * 60 * 60 * 1000
            ).toISOString();
        }
    } else if (body.expires_at !== null) {
        const parsed = Date.parse(body.expires_at);
        if (Number.isNaN(parsed)) throw new Error("The expiry date is not a valid date.");
        if (defaults.strict) {
            if (parsed <= defaults.sentAt.getTime()) {
                throw new Error(
                    "This document's deadline has already passed. Set a new one before sending."
                );
            }
            if (parsed > defaults.sentAt.getTime() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
                throw new Error(
                    `A document cannot stay open for more than ${MAX_EXPIRY_DAYS} days.`
                );
            }
        }
        expiresAt = new Date(parsed).toISOString();
    }

    const rawReminders =
        body.reminder_days === undefined ? defaults.defaultReminderDays : body.reminder_days;

    if (!Array.isArray(rawReminders)) throw new Error("reminder_days must be a list of days.");

    const reminderDays = [...new Set(rawReminders)]
        .map((value) => Number(value))
        .sort((a, b) => a - b);

    for (const days of reminderDays) {
        if (!Number.isInteger(days) || days <= 0) {
            throw new Error("Reminder days must be whole numbers of days after sending.");
        }
        if (defaults.strict && expiresAt) {
            const dueAt = defaults.sentAt.getTime() + days * 24 * 60 * 60 * 1000;
            if (dueAt >= Date.parse(expiresAt)) {
                throw new Error(
                    `A reminder on day ${days} would fall on or after the expiry date, so it would never be sent.`
                );
            }
        }
    }

    return { expiresAt, reminderDays };
}

/**
 * The title a row is stored with.
 *
 * A blank title falls back to the template name rather than being refused, and
 * only while saving a DRAFT — `validateForSend` requires a real one. A draft
 * called "" renders as a blank line in the envelope list, which is a draft the
 * sender cannot find; the template's name is the same default the composer
 * pre-fills, so this only ever fires when they deliberately cleared it.
 */
export function draftTitle(body: ComposeBody, templateName: string): string {
    return body.title?.trim() || templateName;
}
