/**
 * The audit payload contract — who acted, from where, and how they proved it.
 *
 * WHY A SHARED MODULE. There are three writers of `signature_audit_log`
 * (`senderAuth.logSenderEvent`, `signerAuth.logSignerEvent`,
 * `envelopeNotify.appendEvent`) because there are three kinds of performer, and
 * before CG-016 each described its actor differently: one wrote a bare
 * `actor_user_id` UUID, one wrote `signer_email`, and the cron paths wrote
 * neither. A trail whose identity field depends on which code path wrote the row
 * is a trail a reader has to reverse-engineer. The shape is defined once here and
 * the three writers fill it in.
 *
 * WHY IDENTITY IS SNAPSHOT AND NOT JOINED. `actor_user_id` alone is resolvable
 * to a name — by joining `profiles` at READ time. That answers who the person is
 * today, not who acted then: a renamed profile silently rewrites the trail, and a
 * deleted one erases the performer from it (the FK is ON DELETE SET NULL). So the
 * name, email and phone are copied into the payload as they stood at the moment
 * of the act. The payload is inside the chain hash, so a snapshot cannot be
 * altered afterwards without breaking verification — which is the whole reason
 * `ip` and `user_agent` were put there rather than in columns.
 *
 * WHAT "AUTHENTICATION STATUS" MEANS HERE. Not a boolean. The question a trail
 * must answer is WHICH checks were performed, and it must distinguish "not
 * performed" from "not recorded" — the first is evidence, the second is a hole.
 * `AuditAuth.methods` lists what actually happened; `otp` and `ekyc` are present
 * on every signer entry and explicitly `null` until their drivers are wired
 * (v1.2.0 — the seams are already declared in `signing.ts`), so an entry never
 * implies a verification that did not occur, and never leaves it ambiguous.
 */

import type { SupabaseClient } from "supabase";

// ============================================================
// The contract
// ============================================================

/**
 * `unrecorded` is written by `signature_audit_append` itself when a caller
 * supplies no actor — see the migration for why that is normalized rather than
 * rejected. It is never constructed here; a writer that means it should say so.
 */
export type AuditActorKind =
    | "sender"
    | "signer"
    | "observer"
    | "system"
    /**
     * CG-044. An integration acting through an API key, NOT a person.
     *
     * Distinct from `sender` even though the act is a sender's act and
     * `user_id` names the key's owner: a trail that called both "sender" could
     * not answer "did a human do this, or did their integration?", which is the
     * first question asked when an automated send goes wrong.
     */
    | "api_client";

export type AuditActor = {
    kind: AuditActorKind;
    /** `auth.users.id` for a sender; NULL for an external party or a cron tick. */
    user_id: string | null;
    /** `signature_request_signers.id` for a signer or observer. */
    signer_id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    /**
     * CG-044. WHICH key acted, present only on an `api_client` actor.
     *
     * The id AND the name, snapshot at the moment of the act. `api_key_revoke`
     * stamps `revoked_at` rather than deleting the row precisely so these stay
     * resolvable — but a renamed key must not rewrite what the trail already
     * said, which is why the name is copied here rather than joined later.
     */
    api_key_id?: string;
    api_key_name?: string;
};

/**
 * The verification vocabulary. Extended, never repurposed: a historical entry
 * saying `email_link` must keep meaning what it meant when it was written, so a
 * new mechanism gets a new value rather than a broader reading of an old one.
 */
export type AuditAuthMethod =
    /** Possession of an emailed single-use credential (`signer_access_tokens`). */
    | "email_link"
    /**
     * CG-047. Possession of a credential minted for an EMBEDDED session.
     *
     * A separate value and not a broader reading of `email_link`, under this
     * type's own rule above. `email_link` asserts that somebody reached the
     * signer's MAILBOX; an embed credential never went near one — it was handed
     * to the sender's own integration. Recording `email_link` for it would put
     * a false statement in the hash chain and on the Certificate of Completion.
     */
    | "embed_link"
    /** A Supabase session — see `session` for the assurance level behind it. */
    | "app_session"
    /** A hand-drawn mark captured on the signing surface. */
    | "drawn_signature"
    /** A typed name rendered as the mark. */
    | "typed_signature"
    /** An uploaded image of a signature. */
    | "uploaded_signature"
    /** One-time passcode, email or SMS (v1.2.0). */
    | "otp"
    /** Identity document + liveness check (v1.2.0). */
    | "ekyc"
    /** A CA-issued certificate applied to the document itself (PAdES). */
    | "ca_digital_signature"
    /** No human authenticated — a scheduled task acted. */
    | "system_scheduler"
    /**
     * CG-044. A `cgk_…` key presented by an integration. The weakest claim in
     * this list about WHO acted: it proves possession of a secret the owning
     * organization issued, and nothing about the person behind the call.
     */
    | "api_key";

export type AuditAuth = {
    /** What was actually used, in the order it was used. */
    methods: AuditAuthMethod[];
    /** Always true from a real writer; the DB writes `false` when nothing was supplied. */
    recorded: true;
    /** The credential redeemed, for a signer. Ties the entry to `signer_access_tokens`. */
    token_id?: string | null;
    /**
     * A sender's session assurance, straight from the verified JWT: `aal1` is a
     * password or OAuth session, `aal2` means an MFA factor was satisfied. `amr`
     * is the provider's own list of methods and the times they were satisfied.
     */
    session?: { aal: string | null; amr: unknown } | null;
    /**
     * Explicitly `null` until the OTP driver is wired. `null` is the record that
     * no passcode challenge was issued — distinct from the key being absent,
     * which would only mean nobody wrote it down.
     */
    otp: { channel: string; verified_at: string } | null;
    /** Same discipline as `otp`, for the eKYC identity driver. */
    ekyc: { provider: string; verdict: string; verified_at: string } | null;
    /**
     * Set on `document_signed`, where the certificate facts are known. Every
     * other entry records `null` — a party's own signing act is not a CA act.
     */
    ca_signature?: {
        provider: string;
        certificate_subject: string | null;
        certificate_serial: string | null;
        self_signed: boolean | null;
    } | null;
};

/** What every writer merges into its payload. */
export type AuditEvidence = {
    actor: AuditActor;
    auth: AuditAuth;
    ip: string | null;
    user_agent: string | null;
};

// ============================================================
// Builders
// ============================================================

export function systemEvidence(args: {
    /** The scheduled task acting — `envelopes_cron_expire`, say. */
    task: string;
}): AuditEvidence {
    return {
        actor: {
            kind: "system",
            user_id: null,
            signer_id: null,
            // Named, not left null: "who expired this document" has an answer,
            // and it is a task rather than a person.
            name: args.task,
            email: null,
            phone: null,
        },
        auth: { methods: ["system_scheduler"], recorded: true, otp: null, ekyc: null },
        // No client to have an address. The server's own would be a fabricated
        // fact — the trail says "nobody dialled in" by saying nothing.
        ip: null,
        user_agent: null,
    };
}

export type UserIdentity = { name: string | null; email: string | null; phone: string | null };

/**
 * Resolves an `auth.users.id` to the identity to be snapshot.
 *
 * `profiles` first for name/email/phone, then `auth.users` for the phone a
 * phone/MFA signup verified — CG-016 backfilled the latter into the former, so
 * this fallback covers only numbers added to `auth.users` since.
 *
 * Cached BRIEFLY, and the TTL is the point rather than a detail. The notify loops
 * resolve the same sender once per recipient, so an uncached resolver issues a
 * query per email sent; but an isolate can live for many minutes, and a snapshot
 * is only evidence if it is the identity AT THE TIME OF THE ACT. A cache with no
 * expiry would quietly record a name the user had already changed — the exact
 * failure that reading `profiles` at display time was rejected for. A minute
 * bounds that to the span of a single fan-out.
 */
const IDENTITY_CACHE_TTL_MS = 60_000;
const identityCache = new Map<string, { at: number; identity: UserIdentity }>();

export async function resolveUserIdentity(
    admin: SupabaseClient,
    userId: string | null
): Promise<UserIdentity> {
    if (!userId) return { name: null, email: null, phone: null };

    const cached = identityCache.get(userId);
    if (cached && Date.now() - cached.at < IDENTITY_CACHE_TTL_MS) return cached.identity;

    const { data: profile, error } = await admin
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", userId)
        .maybeSingle();

    // A failure here must not cost the entry its other evidence — the IP, the
    // time and the event are still worth recording, and a null name is honest.
    if (error) console.error("resolveUserIdentity: profile lookup failed:", error);

    let phone = (profile?.phone as string | null) ?? null;
    if (!phone) {
        // TRY/CATCH, and not for tidiness: this is the one call here that throws
        // rather than returning an error, and `resolveSender` awaits this function
        // before a send, a void or a signature. A phone lookup that failed must
        // cost the trail a phone number, never cost the user their action.
        try {
            const { data: authUser } = await admin.auth.admin.getUserById(userId);
            phone = authUser?.user?.phone || null;
        } catch (err) {
            console.error("resolveUserIdentity: auth phone lookup failed:", err);
        }
    }

    const identity: UserIdentity = {
        name: (profile?.full_name as string | null) ?? null,
        email: (profile?.email as string | null) ?? null,
        phone,
    };
    identityCache.set(userId, { at: Date.now(), identity });
    return identity;
}

/**
 * The actor block for a recipient — signer or CC observer.
 *
 * Built from the row rather than resolved, because for an external party the row
 * IS the identity: `signer_name`, `signer_email` and `signer_phone` are what the
 * sender recorded about them, and that snapshot must not change afterwards.
 *
 * `userId` is the account they proved themselves with, where they proved one —
 * signing requires it, opening the document does not. It ADDS to the row's
 * identity rather than replacing it: the row says who the sender addressed, the
 * account says who turned up, and an entry that showed only the second would
 * lose the first.
 */
export function recipientActor(
    signer: {
        id: string;
        signer_name: string | null;
        signer_email: string | null;
        signer_phone?: string | null;
        recipient_type?: "signer" | "cc" | null;
    },
    userId: string | null = null
): AuditActor {
    return {
        kind: signer.recipient_type === "cc" ? "observer" : "signer",
        user_id: userId,
        signer_id: signer.id,
        name: signer.signer_name ?? null,
        email: signer.signer_email ?? null,
        phone: signer.signer_phone ?? null,
    };
}

/**
 * The identification of the person an entry is ABOUT, where that is someone
 * other than the performer — a recipient being emailed, reminded or copied.
 *
 * Separate from `actor` because conflating them would make the trail claim the
 * recipient did something: `signer_notified` is an act of the sender's upon a
 * recipient, and "who was contacted, at what address, on what number" is a
 * different question from "who performed this".
 */
export function recipientSnapshot(signer: {
    signer_name?: string | null;
    signer_email?: string | null;
    signer_phone?: string | null;
}): UserIdentity {
    return {
        name: signer.signer_name ?? null,
        email: signer.signer_email ?? null,
        phone: signer.signer_phone ?? null,
    };
}

/**
 * Reads `aal` and `amr` out of an already-verified access token.
 *
 * DECODE, NOT VERIFY, and deliberately: the caller has just proved the token
 * with `auth.getUser()`, which checks the signature against the project's key.
 * Re-verifying here would need the JWT secret in a second place for no gain.
 * The worst case of a malformed token is a null in the payload, which is why
 * every failure path returns nulls instead of throwing.
 *
 * THIS USED TO SAY "nothing is authorized on them". Since CG-031, one thing is:
 * `sessionProvedMailbox` below reads `amr` to decide whether a magic-link signer
 * may sign. That is sound only because of the first paragraph — the token these
 * claims come from has already been verified by `auth.getUser()` in the same
 * call, so a forged one never reaches the decode. Anything that reads these
 * claims WITHOUT that prior verification is reading attacker-controlled input.
 */
export function readSessionClaims(
    authHeader: string | null
): { aal: string | null; amr: unknown } | null {
    if (!authHeader) return null;
    try {
        const jwt = authHeader.replace(/^Bearer\s+/i, "");
        const [, payloadSegment] = jwt.split(".");
        if (!payloadSegment) return null;
        const json = atob(payloadSegment.replace(/-/g, "+").replace(/_/g, "/"));
        const claims = JSON.parse(json) as { aal?: unknown; amr?: unknown };
        return {
            aal: typeof claims.aal === "string" ? claims.aal : null,
            amr: claims.amr ?? null,
        };
    } catch {
        return null;
    }
}

/**
 * Whether the session behind these claims was established by proving the
 * mailbox — a magic link or an emailed sign-in code — rather than by a secret
 * the holder already had.
 *
 * WHY THIS EXISTS. `assertSignerAccount` requires `profiles.email_verified`, and
 * for good reason: without it, anyone could register a signer's address, never
 * open the inbox, and sign as them. But this project's verification loop
 * (CG-006) is the only writer of that column, so a recipient who signs in by
 * magic link — having demonstrably opened the mailbox seconds earlier — would be
 * refused for not having demonstrated it. Same proof, wrong column.
 *
 * So the check widens to accept either. `email_verified` is the persistent
 * claim; this is the per-session one, and it deliberately does NOT persist: it
 * cannot be inherited by a later password login on the same account, which is
 * exactly what flipping the column would have allowed.
 *
 * GoTrue writes `amr` as a list of `{ method, timestamp }`. Older shapes emit
 * bare strings, so both are read — a signer must not be refused because their
 * auth server serialises a claim differently than ours did.
 *
 * FAILS CLOSED. A missing, malformed, or unrecognised `amr` returns false, and
 * the caller is left with `email_verified` as the only route. "We could not tell
 * how this session was established" must never resolve to "sign it".
 */
export function sessionProvedMailbox(
    session: { aal: string | null; amr: unknown } | null
): boolean {
    if (!Array.isArray(session?.amr)) return false;

    return session.amr.some((entry) => {
        const method =
            typeof entry === "string"
                ? entry
                : typeof (entry as { method?: unknown })?.method === "string"
                  ? (entry as { method: string }).method
                  : null;

        // `otp` covers both the emailed six-digit code and the magic link —
        // GoTrue does not distinguish them, and neither should this, because
        // they prove the identical thing. `email` and `magiclink` are the older
        // spellings. `password` and `oauth` are deliberately absent: neither
        // says anything about the mailbox.
        return method === "otp" || method === "magiclink" || method === "email";
    });
}

/** Maps a stored capture method onto the vocabulary above. */
export function signatureMethodOf(captureMethod: string | null): AuditAuthMethod | null {
    switch (captureMethod) {
        case "drawn":
            return "drawn_signature";
        case "typed":
            return "typed_signature";
        case "uploaded":
            return "uploaded_signature";
        default:
            return null;
    }
}
