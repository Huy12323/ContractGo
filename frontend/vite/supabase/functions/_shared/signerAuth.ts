/**
 * Signer authentication — the mandatory first statement of every public
 * (JWT-verification-off) signing function.
 *
 * WHY THIS EXISTS AT ALL. A real signer arrives from an emailed link and belongs
 * to no organization, so none of the project's normal authorization applies:
 * there is no `auth.uid()` on the read path, no membership row, nothing RLS can
 * key on. Signing itself additionally requires the signer to prove who they are
 * — see `assertSignerIdentity` — but that is a check ON TOP of the token, not a
 * replacement for it: the proof says who turned up, and only the token says
 * which signer on which request they are.
 *
 * WHAT COUNTS AS THAT PROOF IS THE SENDER'S CHOICE (CG-031), pinned onto the
 * request as `signer_auth` when it was sent:
 *
 *   'account'    a session on the signer's own proved address, which is what
 *                this module required unconditionally before CG-031.
 *   'email_otp'  a one-time passcode, redeemed against this very token within a
 *                short window — OR a session on the signer's own address, which
 *                is strictly stronger and is accepted in its place. No account is
 *                REQUIRED at any point; one is simply not thrown away when it is
 *                already there.
 *
 * `assertSignerIdentity` is the branch; `assertSignerAccount` is still the whole
 * of the first arm and is unchanged apart from the magic-link widening noted on
 * it. Neither arm weakens the token: both are additive to it.
 *
 * The alternative — `anon` RLS policies over the envelope tables — was rejected
 * (plan decision #2). Every external action here is a state-machine transition
 * rather than a row write, the audit trail legally requires the IP and
 * user-agent that only an edge function can see, and default-deny means a
 * leaked anon key cannot reach a single envelope row. `signer_access_tokens`
 * therefore has no RLS policies at all and is only reachable through the
 * SECURITY DEFINER routines called below.
 *
 * THE TOKEN NEVER TRAVELS IN A URL. Query strings leak through `Referer`
 * headers, browser history and server logs, and corporate mail scanners
 * pre-fetch links — which is also why redemption caps uses instead of being
 * strictly single-use. The frontend keeps the token in the route path only long
 * enough to POST it in a request body.
 *
 * WHAT THIS MODULE DOES NOT DO: it never decides whether the signer may *act*,
 * only who they are and what they are looking at. Turn-taking is
 * `signature_claim_turn`'s single-statement job — see the RPC migration.
 */

import { createClient, type SupabaseClient } from "supabase";
import type { Rpc_SignerTokenRedeem } from "./rpcRows.ts";
import { corsHeaders, getRequestIp, jsonResponse, requireEnv } from "./http.ts";
import {
    type AuditAuth,
    type AuditAuthMethod,
    readSessionClaims,
    recipientActor,
    sessionProvedMailbox,
} from "./auditEvidence.ts";

// Re-exported so the public signing functions keep importing them from here —
// they were defined in this module before `_shared/http.ts` existed, and moving
// the definitions is not a reason to touch four call sites.
export { corsHeaders, getRequestIp, jsonResponse };

// ============================================================
// Errors
// ============================================================

/**
 * Machine-readable refusals the SIGNER SURFACE has to branch on, as opposed to
 * merely display. Deliberately only these: every one means "the right person may
 * still act, from this session or another", so the page has to offer a way back
 * in rather than a dead end. Everything else stays a sentence, because everything
 * else is terminal for the person reading it.
 */
export type SignerAuthErrorCode =
    | "sign_in_required"
    | "account_mismatch"
    | "email_not_verified"
    // CG-031. Same property as the other three: the right person is very likely
    // the one reading it, and they can act from this same session as soon as
    // they answer a code. A dead end here is an unsigned contract.
    | "otp_required"
    // [ekyc] CG-033. Same property again: the right person is reading it, and
    // they can act from this same link as soon as they pass the check. ONE code
    // and not two — a rejected verdict is already representable in the session's
    // `identity_check` block, so a second code would be a second way to say the
    // same thing and a second line for the removal recipe to revert.
    | "identity_check_required";

/**
 * Thrown for every rejection. `status` and `message` are what the caller is
 * allowed to see; anything more specific stays in the logs. Distinguishing
 * "expired" from "revoked" from "no such token" would turn the endpoint into an
 * oracle for probing which emailed links are still live.
 */
export class SignerAuthError extends Error {
    constructor(
        readonly status: number,
        message: string,
        /** Detail for the server log only — never returned to the caller. */
        readonly detail?: string,
        /** Returned to the caller alongside `message`. See the type above. */
        readonly code?: SignerAuthErrorCode
    ) {
        super(message);
        this.name = "SignerAuthError";
    }
}

const INVALID_TOKEN = () => new SignerAuthError(401, "This signing link is no longer valid.");

// ============================================================
// Request-scoped facts
// ============================================================

export function getUserAgent(req: Request): string | null {
    return req.headers.get("user-agent");
}

export async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// ============================================================
// Resolved context
// ============================================================

export type SignerContext = {
    /** `signer_access_tokens.id` — pass to `signer_token_consume` when done. */
    tokenId: string;
    purpose: "sign" | "view";
    signer: {
        id: string;
        request_id: string;
        organization_id: string;
        signer_order: number;
        signer_email: string;
        signer_name: string;
        /** As the sender recorded it (CG-016). Identification evidence; nullable. */
        signer_phone: string | null;
        /** `cc` is an observer — CG-011. Decides whether they act or merely watch. */
        recipient_type: "signer" | "cc";
        status: "pending" | "notified" | "viewed" | "signed" | "declined" | "changes_requested";
        /** Which `template_snapshot.signer_roles[].id` this person fulfils.
         *  NULL for a `cc` observer — CG-011 forbids them a role. */
        role_id: string | null;
        /** Keyed by `TemplateField.id`. */
        field_values: Record<string, unknown> | null;
        /** Why the sender sent this turn back (CG-014). Non-null only while the
         *  signer is `changes_requested`, and shown to them on their return. */
        changes_requested_reason: string | null;
        /** This recipient's override of `request.signer_auth` (CG-032). NULL —
         *  which is every row created before that migration — means INHERIT.
         *  Read only through `resolveEffectiveSignerAuth`, never directly. */
        auth_method: "account" | "email_otp" | null;
        /** [ekyc] This recipient's override of `request.require_identity_check`
         *  (CG-033). NULL means INHERIT. Read only through
         *  `resolveEffectiveIdentityCheck`. */
        require_identity_check: boolean | null;
    };
    request: {
        id: string;
        organization_id: string;
        title: string;
        status: "draft" | "in_progress" | "completed" | "declined" | "cancelled" | "expired";
        current_order: number;
        source_pdf_r2_key: string;
        source_pdf_sha256: string;
        signed_pdf_r2_key: string | null;
        template_snapshot: unknown;
        /** Sender-filled values (CG-007), keyed by `TemplateField.id`. Read-only
         *  context for every signer — no signer owns these field ids. */
        prefilled_values: Record<string, unknown> | null;
        /** How this document's recipients prove who they are (CG-031). Chosen by
         *  the sender and pinned at send time; `assertSignerIdentity` branches
         *  on it and nothing else reads it. */
        signer_auth: "account" | "email_otp";
        /** [ekyc] Whether recipients must pass a government-ID check before
         *  signing (CG-033). ORTHOGONAL to `signer_auth`, not a value on it —
         *  see the migration header. `false` on every document sent before it. */
        require_identity_check: boolean;
    };
    /**
     * True when this signer may act right now: the request is in flight, the
     * routing order has reached them, and they have neither signed nor declined.
     * Advisory only — the authoritative check is `signature_claim_turn`, which
     * asserts the same conditions inside the write that depends on them.
     */
    isMyTurn: boolean;
    ip: string | null;
    userAgent: string | null;
    /**
     * The ContractGo account the caller is signed in as, once `assertSignerAccount`
     * has proved it belongs to this signer. NULL on every read path — opening a
     * document needs no account — and non-null for the whole of a submit or a
     * decline, which is why it lives on the context rather than being handed back
     * to one caller: every audit entry those functions write must record that the
     * act was authenticated by a session and not by the emailed link alone.
     */
    account: SignerAccount | null;
    /**
     * The passcode this ceremony was authenticated by, once `assertSignerIdentity`
     * has accepted one. NULL on every read path and in `account` mode.
     *
     * ON THE CONTEXT AND NOT THREADED THROUGH EACH `logSignerEvent` CALL, for the
     * same reason `account` is: every entry written after the check must record
     * the ceremony's true strength, and there are eight call sites across submit
     * and decline. Threading it would mean each one has to remember, and the ones
     * that forgot would claim a WEAKER ceremony than actually happened — a trail
     * that understates its own evidence is as wrong as one that overstates it.
     */
    otp: { channel: string; verified_at: string } | null;
    /**
     * Raw `signer_access_tokens.otp_verified_at` as the redeem returned it.
     * Distinct from `otp` above: this is what the database knows, that is what
     * this request is entitled to claim. `assertSignerIdentity` turns the first
     * into the second only after judging it against the freshness window.
     */
    otpVerifiedAt: string | null;
    /**
     * [ekyc] The identity check this ceremony rests on, once `assertIdentityChecked`
     * has found a live approval — CG-033. NULL on every read path, in every mode
     * that does not require one, and until the arm runs.
     *
     * ON THE CONTEXT for the same reason `account` and `otp` are, and SHAPED
     * ASSIGNMENT-COMPATIBLE WITH `AuditAuth["ekyc"]` so `logSignerEvent` can
     * default it in one place with no cast, rather than eight call sites each
     * having to remember.
     */
    identity: { provider: string; verdict: string; verified_at: string } | null;
    /**
     * CG-047. The origin this credential was minted for, or NULL for an ordinary
     * emailed link — which is every token issued before v1.4.0 and every one
     * `envelopes_send` issues today.
     *
     * IT DOES TWO JOBS AND THE SECOND IS THE IMPORTANT ONE.
     *
     * `signing_session_open` hands it to the page, which uses it as the
     * `postMessage` target and emits nothing without it. That is the visible job.
     *
     * The other is EVIDENCE. Every entry this module chains records
     * `auth.methods`, and for a token redemption that used to be the constant
     * `email_link` — a claim that somebody reached the SIGNER'S MAILBOX. An
     * embed credential never went near a mailbox: it was handed to the sender's
     * own integration. Recording `email_link` for it would put a false statement
     * in the hash chain and on the Certificate of Completion, so the presence of
     * this value is what selects `embed_link` instead.
     *
     * Read with its own primary-key lookup rather than added to
     * `signer_token_redeem`'s RETURNS TABLE: that function is the authorization
     * primitive every signing call funnels through, and changing its result type
     * means a DROP + CREATE that re-inherits Supabase's default grants
     * (CG-010/CG-015). One indexed lookup on a path that already runs three
     * queries is the cheaper risk.
     */
    embedOrigin: string | null;
    /** service_role client, already constructed. Reuse it; don't make another. */
    admin: SupabaseClient;
};

/** A verified Supabase session belonging to the signer named on the request. */
export type SignerAccount = {
    userId: string;
    /** From the JWT, lower-cased — the value that was matched, not the raw claim. */
    email: string;
    /** `aal`/`amr`, recorded rather than authorized on. See `readSessionClaims`. */
    session: { aal: string | null; amr: unknown } | null;
};

let cachedAdmin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
    cachedAdmin ??= createClient(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    return cachedAdmin;
}

/**
 * Resolves the bearer token in `body.access_token` to a full signing context.
 *
 * Redemption is one atomic `UPDATE … RETURNING` in `signer_token_redeem`: the
 * expiry, revocation, consumption and use-cap checks and the use-count
 * increment are the same statement, so concurrent requests cannot both slip
 * past the cap. Splitting that into a read-then-write here would reintroduce
 * exactly the race the SQL was written to avoid.
 *
 * @throws SignerAuthError — always safe to return verbatim to the caller.
 */
/**
 * The origin an embed credential was minted for — CG-047. NULL for every emailed
 * link, and NULL again if the lookup fails.
 *
 * NEVER THROWS. The consequence of null is an embed bridge that stays quiet and
 * an `email_link` in the evidence; the consequence of throwing would be a signer
 * who cannot open their document at all. Between a degraded embed and a broken
 * ceremony there is no contest.
 */
async function loadEmbedOrigin(admin: SupabaseClient, tokenId: string): Promise<string | null> {
    const { data, error } = await admin
        .from("signer_access_tokens")
        .select("embed_origin")
        .eq("id", tokenId)
        .maybeSingle<{ embed_origin: string | null }>();

    if (error) {
        console.error("loadEmbedOrigin failed:", error);
        return null;
    }
    return data?.embed_origin ?? null;
}

export async function resolveSignerToken(
    req: Request,
    body: { access_token?: unknown },
    opts: {
        /**
         * Whether this call spends one of the token's `max_uses` (CG-031).
         *
         * TRUE for everything that is a person opening or acting on the
         * document, which is what the counter is FOR. FALSE for the passcode
         * endpoints, and that exception is load-bearing rather than tidy: a
         * signer fumbling codes on a slow phone would otherwise burn through
         * their own link, and — much worse — anyone holding a LEAKED link could
         * call `signing_otp_send` a hundred times and permanently lock the real
         * signer out of a document they are the only person entitled to sign.
         *
         * It also keeps the once-per-credential `signer_token_redeemed` entry
         * below attached to the right act: with this false, a passcode request
         * can never be a token's first redemption.
         */
        countUse?: boolean;
    } = {}
): Promise<SignerContext> {
    const accessToken = body?.access_token;
    if (typeof accessToken !== "string" || accessToken.length < 16) {
        throw INVALID_TOKEN();
    }

    const admin = getAdminClient();
    const ip = getRequestIp(req);

    const { data: redeemed, error: redeemError } = await admin
        .rpc("signer_token_redeem", {
            p_token_hash: await sha256Hex(accessToken),
            p_ip: ip,
            p_count_use: opts.countUse ?? true,
        })
        .maybeSingle<Rpc_SignerTokenRedeem>();

    if (redeemError) {
        // A failure here is ours, not the caller's — but the caller still learns
        // nothing beyond "not valid".
        console.error("signer_token_redeem failed:", redeemError);
        throw INVALID_TOKEN();
    }
    // A rejected token is deliberately NOT chained. There is no request id to
    // chain it to — the redeem found no row, so it resolved nothing — and
    // minting a synthetic one to hold the entry would put a fabricated row in
    // the evidence trail. `signer_access_denied` is reserved for refusals that
    // happen with a resolved context, which `assertCanAct` is.
    if (!redeemed) throw INVALID_TOKEN();

    const { data: signer, error: signerError } = await admin
        .from("signature_request_signers")
        .select(
            "id, request_id, organization_id, signer_order, signer_email, signer_name, signer_phone, recipient_type, status, role_id, field_values, changes_requested_reason, auth_method, require_identity_check"
        )
        .eq("id", redeemed.signer_id)
        .single();

    if (signerError || !signer) {
        throw new SignerAuthError(
            404,
            "This signing request no longer exists.",
            signerError?.message
        );
    }

    const { data: request, error: requestError } = await admin
        .from("signature_requests")
        .select(
            "id, organization_id, title, status, current_order, source_pdf_r2_key, source_pdf_sha256, signed_pdf_r2_key, template_snapshot, prefilled_values, signer_auth, require_identity_check"
        )
        .eq("id", redeemed.request_id)
        .single();

    if (requestError || !request) {
        throw new SignerAuthError(
            404,
            "This signing request no longer exists.",
            requestError?.message
        );
    }

    const ctx: SignerContext = {
        tokenId: redeemed.token_id,
        purpose: redeemed.purpose,
        signer,
        request,
        isMyTurn:
            request.status === "in_progress" &&
            request.current_order === signer.signer_order &&
            // `changes_requested` is a signable state (CG-014): the sender sent
            // this turn back, so the signer both may and must act. It is listed
            // here for the same reason it is listed in `signature_claim_turn`'s
            // WHERE clause — this flag and that clause must agree, or the surface
            // renders a document the write then refuses.
            (signer.status === "notified" ||
                signer.status === "viewed" ||
                signer.status === "changes_requested"),
        ip,
        userAgent: getUserAgent(req),
        // Resolved only by `assertSignerAccount`, and only on the acting paths.
        // Doing it here would put an auth-server round trip on every session
        // open — including the ones that only ever render a document.
        account: null,
        // Same discipline: what the token RECORDS is available immediately, what
        // this request may CLAIM is decided by `assertSignerIdentity`.
        otp: null,
        otpVerifiedAt: redeemed.otp_verified_at ?? null,
        // [ekyc] Same discipline again: resolved by `assertIdentityChecked` only
        // on the acting paths. Reading it here would put a query on every
        // session open, including the ones that only ever render a document.
        identity: null,
        // CG-047. Read here, once, so that everything downstream — the session
        // response, the bridge, and every `auth.methods` this module writes —
        // agrees about which kind of credential is in play. A failed read
        // degrades to null, which is the emailed-link behaviour: a signer must
        // not be locked out of their document because one column could not be
        // fetched.
        embedOrigin: await loadEmbedOrigin(admin, redeemed.token_id),
        admin,
    };

    // CHAINED ONCE PER CREDENTIAL, ON ITS FIRST USE — not per call. The chain
    // records what happened to the DOCUMENT, and "a browser polled the session
    // endpoint" is not that; worse, `signature_audit_append` takes FOR UPDATE on
    // the request, so a per-call entry would serialize the signing surface
    // against itself. First use is a different fact and a genuinely evidentiary
    // one: this emailed link was opened for the first time, at this moment, from
    // this address. It is bounded at one entry per `signer_token_issued`, and it
    // is the ONLY trace a `view`-purpose CC observer ever leaves — without it
    // nothing records that an observer opened the document at all.
    //
    // `use_count` is the POST-increment value (CG-015), so first use is 1.
    if (redeemed.use_count === 1) {
        await logSignerEvent(ctx, "signer_token_redeemed", {
            purpose: redeemed.purpose,
        });
    }

    return ctx;
}

/**
 * Rejects a context that is not allowed to mutate anything — used by
 * `signing_submit` / `signing_decline`, never by the read paths, which must
 * still render for a signer whose turn has passed so they can see what they
 * signed.
 *
 * `changes_requested` needs no clause of its own here. It is admitted through
 * `isMyTurn` above, which is the right place: this function's job is to name the
 * states that FORBID acting, and a turn the sender deliberately reopened is not
 * one of them. The `signed` rejection below is what previously blocked a
 * re-signature, and it no longer applies because `signature_request_changes`
 * moves the signer out of `signed` as part of the same transaction that
 * supersedes their capture.
 *
 * ASYNC BECAUSE IT CHAINS ITS REFUSALS. A rejected attempt to act on a document
 * is evidence — a CC observer trying to sign, a signature offered after the
 * deadline, a party acting out of turn — and unlike a rejected token it has a
 * resolved request to chain to. Making the logging the caller's job would mean
 * every future public function has to remember; making the function async means
 * the compiler asks instead.
 *
 * The `reason` in the payload is the internal cause, not the message returned
 * to the caller. The two differ deliberately: the response stays deliberately
 * uninformative, while the chain records what actually happened.
 */
export async function assertCanAct(ctx: SignerContext): Promise<void> {
    const refusal = describeRefusal(ctx);
    if (!refusal) return;

    await logSignerEvent(ctx, "signer_access_denied", {
        reason: refusal.reason,
        signer_status: ctx.signer.status,
        request_status: ctx.request.status,
        signer_order: ctx.signer.signer_order,
        current_order: ctx.request.current_order,
        purpose: ctx.purpose,
    });

    throw new SignerAuthError(refusal.status, refusal.message);
}

/**
 * How long a redeemed passcode authorises acting for.
 *
 * The token itself lives fourteen days and survives a hundred uses, so without a
 * window one answered code would leave the link permanently hot — and a link is
 * the thing that gets forwarded, archived and scanned. Fifteen minutes is longer
 * than any signing ceremony that is actually in progress and shorter than any
 * plausible gap between a link leaking and being used.
 */
const OTP_FRESHNESS_MS = 15 * 60 * 1000;

/**
 * Whether a recorded passcode verdict still authorises acting.
 *
 * EXPORTED SO THERE IS EXACTLY ONE OF THESE. `signing_session_open` reports it
 * to the page and `assertSignerIdentity` enforces it; if those two ever used
 * different windows the surface would either hide a gate the server still wants
 * (a signer stuck on a disabled button with nothing to click) or show one it
 * does not (a gate that cannot be satisfied). The page is deliberately told a
 * BOOLEAN computed here rather than the timestamp, so it cannot re-judge.
 */
export function isOtpFresh(verifiedAt: string | null): boolean {
    if (!verifiedAt) return false;
    const at = Date.parse(verifiedAt);
    return Number.isFinite(at) && Date.now() - at < OTP_FRESHNESS_MS;
}

/**
 * WHAT THIS RECIPIENT MUST PROVE — the sender's per-envelope choice (CG-031)
 * unless the sender excepted this one recipient (CG-032).
 *
 * NULL MEANS INHERIT, and that is the whole compatibility story: every signer
 * row created before CG-032 has `auth_method IS NULL`, so every document in
 * flight and every saved draft resolves to exactly the value that was pinned on
 * it at send time.
 *
 * IT LIVES HERE, IMMEDIATELY ABOVE THE GATE, so the gate and its input are read
 * together. Nothing outside this module may reconstruct the COALESCE — a second
 * copy that disagreed would be an auth requirement two parts of the server
 * resolve differently, which is the failure mode the column was named
 * `auth_method` (and not `signer_auth`) to keep visible.
 */
export function resolveEffectiveSignerAuth(ctx: SignerContext): "account" | "email_otp" {
    return ctx.signer.auth_method ?? ctx.request.signer_auth;
}

/**
 * [ekyc] Whether THIS recipient owes a government-ID identity check — CG-033.
 *
 * The same inheritance rule as `resolveEffectiveSignerAuth` above, over a
 * SEPARATE and ORTHOGONAL axis: a recipient can owe a passcode, an identity
 * check, both, or neither. `false` at the envelope level is the column default,
 * so every document that predates CG-033 answers `false` here and the arm never
 * runs.
 */
export function resolveEffectiveIdentityCheck(ctx: SignerContext): boolean {
    return ctx.signer.require_identity_check ?? ctx.request.require_identity_check;
}

/**
 * THE IDENTITY GATE. Every irreversible act on the signer surface goes through
 * here — `signing_submit` and `signing_decline` both, and the second is not an
 * afterthought: a decline closes the document for EVERY party and revokes every
 * link on it, so an ungated decline would let whoever held one leaked link kill
 * a live multi-party contract for everyone.
 *
 * It resolves the sender's choice into an actual check, and it is the only place
 * that knows there is a choice at all. Since CG-032 that choice is per
 * RECIPIENT — `resolveEffectiveSignerAuth` above, not `ctx.request.signer_auth`
 * — so a witness on an `email_otp` envelope can still be required to hold an
 * account. The audit chain records which proof
 * actually ran rather than which mode was configured — `app_session` when a
 * session satisfied it, `otp` when a passcode did — so a reader can tell a
 * fortnight later, and an `email_otp` envelope signed from an account says so
 * instead of implying a code that was never issued.
 *
 * THE ARMS ARE NOT SYMMETRIC, deliberately. `account` accepts only a session:
 * the sender asked for a signature bound to an account and a passcode would not
 * be one. `email_otp` accepts either, because the sender asked for the recipient
 * not to be BURDENED with an account, which is a floor and not a ceiling.
 *
 * ORDER MATTERS AT THE CALL SITE. This runs AFTER `assertCanAct`, so a signer
 * whose turn has passed — or whose document was voided — is told that, rather
 * than being sent to prove an identity that would not have helped them.
 */
export async function assertSignerIdentity(ctx: SignerContext, req: Request): Promise<void> {
    await assertMailboxIdentity(ctx, req);

    // [ekyc] CG-033. A SECOND, ORTHOGONAL ARM — not a third branch of the one
    // above. `assertMailboxIdentity` answers "did whoever opened this link
    // control the named mailbox"; this answers "is the human at the keyboard who
    // they claim to be in the world". A high-value envelope wants both, which is
    // why the requirement is a boolean beside `signer_auth` rather than a value
    // on it.
    //
    // IT RUNS LAST because the arms answer different questions and the cheaper
    // one should refuse first: a signer who is not signed in as the right person
    // should be told THAT, not sent to photograph a passport that would not have
    // helped them. Same reasoning that puts the whole gate after `assertCanAct`.
    if (!resolveEffectiveIdentityCheck(ctx)) return;
    await assertIdentityChecked(ctx);
}

/**
 * The mailbox arm — CG-031's gate, MOVED HERE VERBATIM and not otherwise
 * touched.
 *
 * IT IS A MOVE, NOT AN EDIT, AND THAT IS LOAD-BEARING. This body returns early
 * TWICE — once after `assertSignerAccount`, once on `account.ok`. Wrapping it in
 * an `if` to add a third arm would make that arm unreachable from both paths,
 * and it would fail OPEN, silently, on exactly the highest-assurance envelopes.
 * Anyone changing this pair should diff this function against CG-031's
 * `assertSignerIdentity` character by character.
 */
async function assertMailboxIdentity(ctx: SignerContext, req: Request): Promise<void> {
    if (resolveEffectiveSignerAuth(ctx) === "account") {
        await assertSignerAccount(ctx, req);
        return;
    }

    // A SIGNED-IN MATCH SATISFIES THE PASSCODE ARM WITHOUT A PASSCODE.
    //
    // `email_otp` says "you do not NEED an account", not "an account is not
    // allowed". Someone already signed in as the address the document names has
    // met a STRONGER bar than the code would set: the passcode proves control of
    // the mailbox right now, and the session proves that plus a persistent
    // identity whose address was proved — `resolveSignerAccount` demands the same
    // mailbox proof either way. Emailing them a code to type would be asking for
    // weaker evidence than they have already produced, and the only thing it
    // could change is whether they give up.
    //
    // It is a TRY, not an assert, which is the whole reason `resolveSignerAccount`
    // exists: not being signed in is the ordinary case here, so a failure must
    // fall through to the code rather than refuse — and must not chain a
    // `signer_access_denied` entry for a ceremony that is about to succeed.
    //
    // NO WEAKENING IS POSSIBLE HERE. Every condition the `account` arm enforces
    // still has to hold for this branch to be taken: same address, mailbox
    // proved, session verified server-side. Anyone who fails any of them lands on
    // the passcode below, exactly as before.
    const account = await resolveSignerAccount(ctx, req);
    if (account.ok) return;

    if (!isOtpFresh(ctx.otpVerifiedAt)) {
        // One refusal for "never answered a code" and "answered one an hour
        // ago", because the remedy is identical and the surface renders it
        // identically: ask for a code. Distinguishing them in the response would
        // tell a holder of a leaked link whether the real signer has been here.
        await denyAccount(ctx, "otp_required", {
            status: 403,
            message: "Enter the code we emailed you before signing.",
            detail: ctx.otpVerifiedAt
                ? `passcode verified at ${ctx.otpVerifiedAt}, outside the freshness window`
                : "no passcode has been verified on this token",
        });
    }

    ctx.otp = { channel: "email", verified_at: ctx.otpVerifiedAt! };
}

/**
 * [ekyc] The identity arm — CG-033.
 *
 * Reads the newest LIVE approval for this SIGNER, not for this token. That is
 * the one place this feature departs from CG-031, and deliberately: a passcode
 * proves control of a mailbox NOW so it must die with the credential a resend
 * withdraws, but an identity verdict is a durable fact about a PERSON.
 * Re-photographing a passport on every resend is hostile to the signer and, with
 * a real vendor, billable. Staleness is the driver's `expires_at`, not a
 * freshness window of ours.
 *
 * A REJECTED CHECK AND A NEVER-STARTED ONE GET THE SAME CODE AND THE SAME
 * STATUS. Only the `detail` — which stays in the logs — distinguishes them.
 * Telling the caller how far the process got would tell a holder of a leaked
 * link whether the real signer has been here, which is the same reason
 * `assertMailboxIdentity` collapses "never answered a code" and "answered one an
 * hour ago" into one refusal.
 */
async function assertIdentityChecked(ctx: SignerContext): Promise<void> {
    const { data: check } = await ctx.admin
        .from("signer_identity_checks")
        .select("provider, status, resolved_at, expires_at")
        .eq("signer_id", ctx.signer.id)
        .eq("status", "approved")
        .order("resolved_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
            provider: string;
            status: string;
            resolved_at: string | null;
            expires_at: string | null;
        }>();

    const live = check && (!check.expires_at || Date.parse(check.expires_at) > Date.now());

    if (!live) {
        await denyAccount(ctx, "identity_check_required", {
            status: 403,
            message: "Verify your identity before signing.",
            detail: check
                ? `identity check approved but expired at ${check.expires_at}`
                : "no approved identity check exists for this signer",
        });
    }

    ctx.identity = {
        provider: check!.provider,
        verdict: "approved",
        // NOT NULL in practice — the `signer_identity_checks_resolution_check`
        // CHECK ties `resolved_at IS NULL` to `status = 'pending'`, and this
        // query filters on `approved`. Coalesced anyway rather than asserted,
        // because an audit entry must never carry a null where it promises a
        // timestamp.
        verified_at: check!.resolved_at ?? new Date().toISOString(),
    };
}

/**
 * Rejects an act that is not being performed from the signer's own ContractGo
 * account, and records the account on the context when it is.
 *
 * WHY THE LINK IS NO LONGER ENOUGH. Possession of the emailed credential proves
 * that someone reached the mailbox; it does not prove WHO. A forwarded link, a
 * shared inbox, or a mail archive is enough to sign in the token-only model, and
 * "the signature was made by whoever had the URL" is a weak answer to the one
 * question a signed contract exists to answer. Requiring a session binds the act
 * to an account whose email was verified at sign-up, so `signer_signed` can
 * record `email_link` AND `app_session` rather than the first alone.
 *
 * IT GATES ACTING, NOT READING. `signing_session_open` deliberately does not
 * call this: a signer must be able to read what they are being asked to sign
 * before deciding whether to create an account for it, and mail scanners that
 * pre-fetch the link must keep landing on a page rather than on a login wall.
 *
 * TWO CONDITIONS, NOT ONE: the session's address must match the signer's, AND
 * that address must be verified. The second is what makes the first mean
 * anything — an unverified sign-up on someone else's address is trivial, so
 * matching alone would move the trust from "held the link" to "typed the
 * address", which is worse rather than better.
 *
 * THE EMAIL IS THE WHOLE MATCH, and it is compared case-insensitively because
 * mailbox names are not case-sensitive in practice and the sender typed one of
 * the two spellings by hand. There is deliberately no `signature_request_signers
 * .signer_user_id` lookup: that column is NULL for external signers (CG-005) and
 * a capture guard trigger compares it against the capture row, so populating it
 * from here would break a constraint that has nothing to do with this check.
 *
 * @throws SignerAuthError carrying a `code` the signer surface branches on.
 */
export async function assertSignerAccount(
    ctx: SignerContext,
    req: Request
): Promise<SignerAccount> {
    const outcome = await resolveSignerAccount(ctx, req);

    // `denyAccount` is declared `Promise<never>` and always throws. Returning its
    // result rather than calling it as a statement is what lets control-flow
    // analysis narrow `outcome` to the `ok: true` arm below — without it the
    // compiler cannot see that this line is unreachable.
    if (!outcome.ok) return await denyAccount(ctx, outcome.reason, outcome.refusal);

    return outcome.account;
}

/**
 * The same checks as `assertSignerAccount`, WITHOUT the refusal.
 *
 * WHY THE SPLIT EXISTS. In `email_otp` mode a signed-in account is not required —
 * it is merely one of two ways to satisfy the identity gate, and the other is a
 * passcode. So that arm has to be able to ASK "is this caller signed in as the
 * signer?" and carry on when the answer is no. `assertSignerAccount` cannot
 * answer that question: it chains a `signer_access_denied` entry and throws, so
 * calling it speculatively would put a refusal on the audit chain for a ceremony
 * that then succeeded — a trail claiming access was denied to someone who signed.
 *
 * So the checks live here, the refusals live in the caller, and the two arms
 * decide independently what a failure means.
 */
type SignerAccountOutcome =
    | { ok: true; account: SignerAccount }
    | {
          ok: false;
          reason: SignerAuthErrorCode;
          refusal: { status: number; message: string; detail?: string };
      };

async function resolveSignerAccount(
    ctx: SignerContext,
    req: Request
): Promise<SignerAccountOutcome> {
    const authHeader = req.headers.get("Authorization");

    // `functions.invoke` sends the anon key here when nobody is signed in, so an
    // absent header and an anon one are the same case: `getUser` rejects both,
    // and neither is allowed to be told apart from the other in the response.
    const asCaller = authHeader
        ? createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
              global: { headers: { Authorization: authHeader } },
          })
        : null;

    const user = asCaller ? (await asCaller.auth.getUser()).data.user : null;

    if (!user?.email) {
        return {
            ok: false,
            reason: "sign_in_required",
            refusal: {
                status: 401,
                message:
                    "Signing requires you to be signed in to the ContractGo account for this document's signer email.",
            },
        };
    }

    const claimed = user.email.trim().toLowerCase();
    const expected = (ctx.signer.signer_email ?? "").trim().toLowerCase();

    if (!expected || claimed !== expected) {
        return {
            ok: false,
            reason: "account_mismatch",
            refusal: {
                status: 403,
                // Names neither address. The signer surface already knows which
                // account it is signed in as and which one the document names, and
                // an anonymous caller must not learn the second by POSTing a token.
                message:
                    "This document is addressed to a different email than the account you are signed in as.",
                // The mismatch itself IS the evidence, so it goes on the chain even
                // though it never reaches the caller.
                detail: `account ${claimed} attempted to act as signer ${expected}`,
            },
        };
    }

    // AND THE ADDRESS HAS TO HAVE BEEN PROVED. GoTrue's own confirmation is off
    // in this project (`enable_confirmations = false`) — verification is the
    // app's, recorded in `profiles.email_verified` by `auth_verify-token`, and it
    // is what gates the whole `_protected` tree. Without this check the account
    // requirement would be theatre: anyone could register the signer's address,
    // never open the mailbox, and sign as them. The row is read with the admin
    // client because a signer has no grants of their own here.
    const { data: profile, error: profileError } = await ctx.admin
        .from("profiles")
        .select("email_verified")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) console.error("resolveSignerAccount: profile lookup failed:", profileError);

    // TWO WAYS TO HAVE PROVED IT, added in CG-031. The column is the persistent
    // claim; the session is the immediate one. A recipient who has just followed
    // a magic link to the address this document names opened that mailbox
    // seconds ago — which is the very thing `email_verified` exists to attest —
    // but our CG-006 loop is that column's only writer, so without this they
    // would be refused for not having proved what they just proved.
    //
    // Deliberately NOT a write. Flipping the column here would grant a permanent
    // credential on the strength of one session and let a later password login
    // inherit it; worse, a trigger doing the same from
    // `auth.users.email_confirmed_at` would flip it for EVERY account in the
    // product, because confirmations being off means GoTrue autoconfirms at
    // signup. See CG-031's PHASE 7 for the full argument.
    //
    // `sessionProvedMailbox` fails closed on a missing or unrecognised `amr`.
    const session = readSessionClaims(authHeader);
    const mailboxProved = !!profile?.email_verified || sessionProvedMailbox(session);

    // A missing profile row fails CLOSED. It should not happen — the sign-up
    // trigger writes one — but "we could not tell whether this address was
    // verified" must never resolve to "sign it".
    if (!mailboxProved) {
        return {
            ok: false,
            reason: "email_not_verified",
            refusal: {
                status: 403,
                message:
                    "Verify your email address before signing. Check your inbox for the ContractGo verification link, then reopen this document.",
                detail: profile
                    ? "email_verified is false and the session did not prove the mailbox"
                    : "no profiles row for the account",
            },
        };
    }

    ctx.account = {
        userId: user.id,
        email: claimed,
        session,
    };

    // A magic-link session IS a passcode ceremony — GoTrue emailed a credential
    // to this address and the holder returned it — so it is recorded as one. Not
    // for symmetry: "how was this signer authenticated" has to have the same
    // answer whether the code was ours or the auth server's, or the trail
    // silently rates two identical proofs differently. `verified_at` is this
    // session's, which is the moment the mailbox was actually demonstrated.
    //
    // Only when the column did NOT already vouch for them. An account that was
    // verified through the CG-006 loop and is now signing in by any means has
    // `app_session` as its method; adding `otp` there would claim a challenge
    // that this ceremony did not issue.
    if (!profile?.email_verified && sessionProvedMailbox(session)) {
        ctx.otp = { channel: "email_link", verified_at: new Date().toISOString() };
    }

    return { ok: true, account: ctx.account };
}

/** Chains the refusal, then throws it. Never returns — hence the `never`. */
async function denyAccount(
    ctx: SignerContext,
    reason: SignerAuthErrorCode,
    refusal: { status: number; message: string; detail?: string }
): Promise<never> {
    await logSignerEvent(ctx, "signer_access_denied", {
        reason,
        detail: refusal.detail ?? null,
        signer_status: ctx.signer.status,
        request_status: ctx.request.status,
        purpose: ctx.purpose,
    });
    throw new SignerAuthError(refusal.status, refusal.message, refusal.detail, reason);
}

function describeRefusal(
    ctx: SignerContext
): { status: number; message: string; reason: string } | null {
    if (ctx.purpose !== "sign") {
        return {
            status: 403,
            message: "This link is read-only.",
            reason: "read_only_token",
        };
    }
    if (ctx.signer.status === "signed") {
        return {
            status: 409,
            message: "You have already signed this document.",
            reason: "already_signed",
        };
    }
    if (ctx.signer.status === "declined") {
        return {
            status: 409,
            message: "You have already declined this document.",
            reason: "already_declined",
        };
    }
    if (ctx.request.status !== "in_progress") {
        return {
            status: 409,
            message: `This document is ${ctx.request.status} and can no longer be signed.`,
            reason: `request_${ctx.request.status}`,
        };
    }
    if (!ctx.isMyTurn) {
        return {
            status: 409,
            message:
                "It is not your turn to sign yet. You will be notified when the document reaches you.",
            reason: "not_my_turn",
        };
    }
    return null;
}

// ============================================================
// Audit
// ============================================================

export type SignerAuditEventType =
    | "signer_viewed"
    | "signer_signed"
    | "signer_declined"
    | "signer_token_redeemed"
    // Already a value of the DB enum, and already written by the SENDER side
    // (`envelopes_remind`, `envelopes_resend`). It was absent from this
    // union only because no signer-side function minted a credential until
    // `signing_submit` began issuing the post-signature download token — the same
    // shape of omission CG-031's passcode events had, and a type-only fix.
    | "signer_token_issued"
    | "signer_access_denied"
    // A decline revokes every link on the document, so the one signer-side
    // function that kills other people's credentials needs to say so.
    | "signer_token_revoked"
    // CG-031's three passcode events. They were shipped as `signature_audit_log`
    // enum values and passed by `signing_otp_send` / `signing_otp_verify` at
    // runtime, but never added here — a real type error that went unseen because
    // `check:ef` silently skipped with no Deno on PATH (v1.2.0 Finding 1).
    | "signer_otp_issued"
    | "signer_otp_verified"
    | "signer_otp_failed"
    // [ekyc] CG-033. Named for the ACT and not the vendor category, so that if
    // the eKYC driver is torn out and a notary, national-eID or bank-ID flow
    // lands later, these are still the right words and get reused rather than
    // joined by a fourth vocabulary. They are permanent — PostgreSQL cannot drop
    // an enum value — which is exactly why the name was chosen this way.
    | "signer_identity_started"
    | "signer_identity_verified"
    | "signer_identity_failed"
    // CG-049. The assistant was used on this credential — recorded ONCE per
    // token, with no question and no answer text. What the transcript is
    // deliberately NOT allowed to become is argued in the CG-049 migration's
    // PHASE 7: the chain's writer takes FOR UPDATE on the request row, a
    // certificate is not a chat log, and a signer's questions about why they
    // hesitate go to the counterparty on that certificate — an entry you can
    // never lawfully redact is a defect, not rigour.
    | "signer_ai_question_asked"
    | "signer_fields_saved"
    | "document_burned"
    | "document_signed"
    | "request_completed";

/**
 * Appends to the hash chain through the single writer, `signature_audit_append`.
 *
 * IP and user-agent go into the payload rather than into columns because the
 * chain hashes the payload — evidence that is not hashed is evidence that can
 * be edited without breaking the chain, which defeats the point.
 *
 * Never throws: a failed audit write must not roll back a completed signature,
 * and the gap is itself detectable (the sequence is contiguous by construction,
 * so a missing event shows up as a missing transition, not a broken chain).
 */
export async function logSignerEvent(
    ctx: SignerContext,
    eventType: SignerAuditEventType,
    payload: Record<string, unknown> = {},
    /**
     * Verification methods this particular act involved, beyond the emailed link
     * that got them here — the signature mark's provenance on `signer_signed`,
     * the certificate on `document_signed`. Merged into `auth`, never replacing
     * it: possession of the credential is a fact about every signer entry.
     */
    auth: Partial<Pick<AuditAuth, "otp" | "ekyc" | "ca_signature">> & {
        methods?: AuditAuthMethod[];
    } = {}
): Promise<void> {
    const { error } = await ctx.admin.rpc("signature_audit_append", {
        p_request_id: ctx.request.id,
        p_organization_id: ctx.request.organization_id,
        p_signer_id: ctx.signer.id,
        // NULL on the read paths, where the signer id in the column above is the
        // only actor identity there is. Non-null once `assertSignerAccount` has
        // run: an act performed from a proved account should name that account,
        // and "which user id signed this" is otherwise unanswerable from the
        // chain even though the server knew it at the time.
        p_actor_user_id: ctx.account?.userId ?? null,
        p_event_type: eventType,
        p_payload: {
            ...payload,
            // Kept alongside `actor.email` and not folded into it: every entry
            // written before CG-016 carries this key, and the reader that
            // understands the historical rows should not need a second branch for
            // the current ones.
            signer_email: ctx.signer.signer_email,
            actor: recipientActor(ctx.signer, ctx.account?.userId ?? null),
            auth: {
                // Possession of the single-use emailed credential is the signer's
                // base authentication, and `token_id` is what ties the claim to the
                // `signer_access_tokens` row that records its issue, expiry and use
                // count. Anything stronger is additive.
                // `app_session` sits second because that is the order they were
                // used: the link got them here, the account proved who they are.
                // Its presence is exactly the difference between "whoever held
                // the URL" and "the account whose address the document names".
                methods: [
                    // CG-047. WHICH kind of credential got them here, not a
                    // constant. `email_link` asserts a mailbox was reached;
                    // `embed_link` asserts only that the sender's integration
                    // was handed a URL. Both are the weakest claim in the list
                    // and neither carries identity on its own — that is what the
                    // account or the passcode below it is for.
                    ctx.embedOrigin ? "embed_link" : "email_link",
                    ...(ctx.account ? (["app_session"] as AuditAuthMethod[]) : []),
                    // CG-031. Third because that is the order it happened: the
                    // link got them here, the account (if any) said who they
                    // are, and the passcode proved they hold the mailbox now.
                    // Read off the context rather than passed in, so every entry
                    // a verified ceremony writes carries it — see `ctx.otp`.
                    ...(ctx.otp ? (["otp"] as AuditAuthMethod[]) : []),
                    // [ekyc] CG-033. Fourth, and last of the identity proofs,
                    // because it is the strongest claim the chain can make: not
                    // "they reached the mailbox" but "a document check said this
                    // is the person". Same context-read discipline as `otp`.
                    ...(ctx.identity ? (["ekyc"] as AuditAuthMethod[]) : []),
                    ...(auth.methods ?? []),
                ],
                recorded: true,
                token_id: ctx.tokenId,
                // What stood behind that session — `aal2` means an MFA factor
                // did. NULL on the read paths, where there is no session at all.
                session: ctx.account?.session ?? null,
                // Explicit nulls, and the reason is the whole point of recording
                // authentication status: "no passcode was required" is evidence,
                // while a missing key would only prove nobody wrote it down.
                //
                // `otp` stopped always being null in CG-031 — this is the driver
                // the comment used to promise. It still reads null for every
                // `account`-mode ceremony and every read path, which is the
                // record that no passcode was demanded there.
                //
                // `ekyc` stopped always being null in CG-033, and reads off the
                // context for exactly the reason `otp` does: there are eight
                // call sites across submit and decline, and the ones that forgot
                // to pass it would claim a WEAKER ceremony than actually
                // happened. It still reads null for every envelope that does not
                // require a check, which is the record that none was demanded.
                otp: auth.otp ?? ctx.otp ?? null,
                ekyc: auth.ekyc ?? ctx.identity ?? null, // [ekyc]
                ca_signature: auth.ca_signature ?? null,
            } satisfies AuditAuth,
            ip: ctx.ip,
            user_agent: ctx.userAgent,
            token_id: ctx.tokenId,
        },
    });

    if (error) console.error(`Audit append (${eventType}) failed:`, error);
}

// ============================================================
// HTTP plumbing
// ============================================================
// `corsHeaders` and `jsonResponse` now live in `_shared/http.ts` and are
// re-exported at the top of this file — the sender-side functions need the same
// three lines and could not import them from a module named "signerAuth"
// without implying an authorization model they do not use.

/**
 * Wraps a public signing handler with the OPTIONS/method/JSON-parse/error
 * boilerplate every one of them needs identically. `SignerAuthError` is the
 * only error class whose message reaches the caller; everything else is logged
 * and returned as a bare 500, so an unexpected Postgres message can never leak
 * table names or row contents to an anonymous caller.
 */
export function servePublicSigningFunction(
    name: string,
    handler: (body: Record<string, unknown>, req: Request) => Promise<Response>
) {
    Deno.serve(async (req) => {
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        if (req.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405);
        }

        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return jsonResponse({ error: "Invalid request body" }, 400);
        }

        try {
            return await handler(body, req);
        } catch (err) {
            if (err instanceof SignerAuthError) {
                if (err.detail) console.warn(`${name}: ${err.detail}`);
                // `code` only where one was set — an absent key keeps the
                // existing refusals byte-identical to what they returned before.
                return jsonResponse(
                    err.code ? { error: err.message, code: err.code } : { error: err.message },
                    err.status
                );
            }
            console.error(`${name} error:`, err);
            return jsonResponse({ error: "Internal error" }, 500);
        }
    });
}
