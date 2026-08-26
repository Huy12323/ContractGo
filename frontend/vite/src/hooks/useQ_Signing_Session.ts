import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";

/**
 * Opens a signing session for an external signer.
 *
 * NOT a table query, so there is no `QueryKeys` entry and no realtime channel:
 * the caller has no database grants at all (plan decision #2 — no `anon` RLS
 * policies anywhere), and `signing_session_open` is the only thing that can see
 * the request on their behalf.
 *
 * The access token travels in the POST BODY, never in a query string. Query
 * strings leak through `Referer` headers and server logs, and corporate mail
 * scanners pre-fetch links — the token being in the route path is unavoidable
 * (it is what the emailed link carries), but it stops there.
 */

/**
 * Exported so `useM_Signing_Submit` invalidates the exact key this hook writes.
 * Because the session sits outside the `QueryKeys` factory, nothing would catch
 * a drifting string literal at compile time — this is the one factory the
 * project owns by hand, per the base skill's "Query Key Factory for Mutation
 * Reuse" pattern.
 */
export const Signing_Session_QueryKey = (accessToken: string) =>
    ["signing_session", accessToken] as const;

export type Signing_Field = {
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
    /** This signer may edit it. Other roles' fields render, but locked. */
    editable: boolean;
};

/**
 * A field the signer satisfies on the SIGN step rather than in the document.
 *
 * Kept as a helper rather than inlined because three places have to agree on it,
 * and `signing_submit` is the fourth — its `mySignatureFields` filter is this
 * same predicate. When they disagreed, the signer reached a dead end: the sign
 * step decided no mark was needed, the server disagreed, and the rejection
 * bounced them back to a filler with nothing wrong in it.
 */
export const utils_Signing_IsSignatureField = (field: Signing_Field): boolean =>
    field.type === "signature" || field.type === "initials";

/**
 * "Is this box mine?" — by ROLE, not by `editable`.
 *
 * `editable` answers a narrower question: may the signer type into it in the
 * document? `signing_session_open` says no for every `signature` field, because
 * a signature is captured on the sign step and never typed. That makes
 * `editable` the wrong test for ownership of a signature box — the box IS the
 * signer's, which is precisely why they are asked for a mark at all.
 */
export const utils_Signing_IsMyField = (field: Signing_Field, signerRoleId: string): boolean =>
    field.role_id === signerRoleId;

export type Signing_Session = {
    request: {
        id: string;
        title: string;
        status: "draft" | "in_progress" | "completed" | "declined" | "cancelled" | "expired";
        current_order: number;
    };
    signer: {
        id: string;
        name: string;
        email: string;
        role_id: string;
        signer_order: number;
        status: "pending" | "notified" | "viewed" | "signed" | "declined" | "changes_requested";
        /** The sender's words when they sent this turn back (CG-014). Non-null
         *  only while the signer is `changes_requested`. */
        changes_requested_reason: string | null;
    };
    signer_roles: { id: string; name: string; order: number; color: string }[];
    fields: Signing_Field[];
    field_values: Record<string, unknown>;
    other_field_values: Record<string, unknown>;
    pdf_url: string;
    can_sign: boolean;
    /**
     * Which proof this document's sender requires before anyone signs (CG-031).
     * Decides WHICH gate the page renders — the account gate or the passcode
     * gate — and nothing else.
     *
     * Optional because a browser can be holding a page from before this shipped
     * while the server has already been updated; `Page_Sign` defaults it to
     * `'account'`, which is the stricter of the two.
     */
    auth_requirement?: "account" | "email_otp";
    /**
     * Whether a passcode has already been answered on this token recently enough
     * to still count.
     *
     * A BOOLEAN AND NOT A TIMESTAMP, deliberately: the server owns the freshness
     * window (`isOtpFresh`), and handing the page a timestamp to judge for itself
     * would be two implementations of one rule, drifting. This is only ever the
     * seed for the page's local state — the authority is `signing_submit`'s
     * refusal, which re-checks at the moment of the commit.
     */
    otp_verified?: boolean;
    /**
     * [ekyc] This signer's government-ID check — CG-033.
     *
     * ABSENT WHENEVER NO CHECK IS REQUIRED, which is every document that
     * predates CG-033. `utils_PageSign_IdentityCheckReady(undefined)` is `true`,
     * and that single fact is the whole additive-safety claim on the client.
     *
     * NESTED RATHER THAN FOUR SIBLING FLAT KEYS, and the nesting IS the removal
     * seam: taking eKYC out deletes one property instead of disentangling four
     * from among their neighbours.
     *
     * Advisory, exactly like `can_sign` and `auth_requirement`. The server states
     * what is required and whether it is satisfied; this page never re-judges,
     * and `assertSignerIdentity` re-checks at the commit.
     */
    identity_check?: {
        required: boolean;
        satisfied: boolean;
        status: "not_started" | "pending" | "approved" | "rejected" | "expired";
        /** Only on a rejection — the vendor's truncated text. Never a score. */
        reason?: string;
    };
    /**
     * CG-047. The single origin an EMBEDDED session may report its progress to.
     *
     * `null` or absent for every emailed credential — which is every token this
     * product issued before v1.4.0, and every one `envelopes_send` issues today.
     * `utils_Embed_PostMessage` treats both as SILENCE and emits nothing at all:
     * an absent origin is never a wildcard, and a page framed by an origin the
     * sender never registered gets no events rather than a broadcast.
     *
     * Optional for the same reason `auth_requirement` is — a browser can be
     * holding a page from before this shipped — and the default is the strict
     * one here too, because the default is "say nothing".
     */
    /**
     * CG-049. Whether to offer the AI reading assistant beside the document.
     *
     * Advisory, exactly like `can_sign` and `auth_requirement`:
     * `signer_ai_message_begin` re-checks the sender's org flag and is the
     * authority, because a page that has not reloaded still thinks the feature
     * is on. The server folds three things into this one boolean — the
     * deployment has a driver, the sender has not switched it off, and the
     * document actually has readable text.
     *
     * Optional, and ABSENT MEANS OFF — the strict default `embed_origin` and
     * `identity_check` already follow.
     */
    assistant_enabled?: boolean;
    embed_origin?: string | null;
    /**
     * The finished, burned document — present only once EVERY party has signed.
     *
     * What the receipt shows a signer who asks to see what they signed. Null
     * while others still have to sign: there is no finished document yet, and
     * the receipt falls back to the source PDF with the entered values overlaid,
     * which is what this signer actually agreed to.
     *
     * Optional for the same reason `auth_requirement` is — a browser can hold a
     * page from before this shipped — and absent reads exactly like null.
     */
    signed_pdf_url?: string | null;
    /**
     * This signer's own signature image, once they have signed.
     *
     * Only ever a FALLBACK: during the ceremony the page is holding the mark it
     * just captured, and that is preferred. This is what a receipt opened in a
     * fresh browser — a party returning through `signing_link_for_me` — has
     * instead of nothing.
     */
    my_signature_url?: string | null;
};

export const useQ_Signing_Session = ({ accessToken }: { accessToken: string }) => {
    const query = useQuery({
        queryKey: Signing_Session_QueryKey(accessToken),
        enabled: !!accessToken,
        // The signed PDF URL inside the response expires; refetching on focus
        // would also re-hit the token's use counter on every tab switch, so the
        // session is fetched once and the page drives its own reload.
        refetchOnWindowFocus: false,
        retry: false,
        queryFn: async (): Promise<Signing_Session> => {
            const sb_FunctionsSigningSessionOpen_Invoke = await supabase.functions.invoke(
                "signing_session_open",
                {
                    body: { access_token: accessToken },
                }
            );
            if (sb_FunctionsSigningSessionOpen_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningSessionOpen_Invoke.error);
            }
            return sb_FunctionsSigningSessionOpen_Invoke.data as Signing_Session;
        },
    });

    return { query, session: query.data };
};

/**
 * The refusals the signer surface branches on instead of merely displaying, and
 * the mirror of `SignerAuthError`'s `code` in `_shared/signerAuth.ts`. Both mean
 * the right person can still sign, from a different session — so the page owes
 * them a way in rather than an error message.
 *
 * `sign_in_required`   — nobody is signed in on this browser.
 * `account_mismatch`   — someone is, but not the address the document names.
 * `email_not_verified` — the right address, but never proved. Only the server
 *   can tell (it reads `profiles.email_verified` with admin grants), so unlike
 *   the other two this one arrives as a rejected submit rather than being caught
 *   before the signer commits — its message is written to be read on its own.
 * `otp_required`       — the passcode this document is signed with has not been
 *   answered, or was answered too long ago to still count (CG-031). Like the
 *   first two it is recoverable in place: the gate is already on the page, and
 *   the signer only has to ask for a code.
 * `identity_check_required` — [ekyc] this signer owes a government-ID check and
 *   has not passed one (CG-033). ONE code and not two: a rejected verdict is
 *   already representable in `session.identity_check.status`, so a second code
 *   would be a second way to say the same thing.
 */
export type Signing_ErrorCode =
    | "sign_in_required"
    | "account_mismatch"
    | "email_not_verified"
    | "otp_required"
    | "identity_check_required"; // [ekyc]

/**
 * The signer's own session, sent explicitly on the ACTING calls.
 *
 * `functions.invoke` already attaches whatever the client last called
 * `functions.setAuth` with, but on this page that is a race worth removing
 * rather than reasoning about: the signing surface is the one place a user can
 * arrive cold on a deep link, and an invoke that beat the session restore would
 * send the anon key and be told to sign in while signed in. Awaiting
 * `getSession()` makes the header a fact rather than a timing question.
 *
 * Returns `{}` when nobody is signed in — the caller must still make the call,
 * because the SERVER decides what a missing session means, not the client.
 */
export const utils_Signing_AuthHeaders = async (): Promise<Record<string, string>> => {
    const sb_Auth_GetSession = await supabase.auth.getSession();
    const accessToken = sb_Auth_GetSession.data.session?.access_token;
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};

export type Signing_Error = Error & {
    code?: Signing_ErrorCode;
    missing_fields?: { id: string; label: string }[];
    /** Seconds until a passcode may be requested again (CG-031). Carried for the
     *  same reason `missing_fields` is: it is structured data ON a refusal, and
     *  the surface needs it to render a countdown rather than a dead button. */
    retry_after_seconds?: number;
    /** Guesses left on the current passcode challenge (CG-031). */
    attempts_remaining?: number;
    /** [ekyc] Why an identity check was rejected, when a refusal carries one
     *  (CG-033). Never a score. */
    identity_reason?: string;
};

/**
 * `functions.invoke` reports a non-2xx as a generic FunctionsHttpError and keeps
 * the body on `context`. The signing functions answer with a message written
 * FOR the signer ("This signing link is no longer valid"), so surfacing the
 * generic message instead would replace a useful sentence with a useless one.
 */
export const utils_Signing_UnwrapError = async (error: unknown): Promise<Error> => {
    const context = (error as { context?: Response })?.context;
    if (context && typeof context.json === "function") {
        try {
            const body = (await context.clone().json()) as {
                error?: string;
                code?: Signing_ErrorCode;
                missing_fields?: { id: string; label: string }[];
                retry_after_seconds?: number;
                attempts_remaining?: number;
                status?: string;
                reason?: string; // [ekyc]
            };
            // `body.error` is absent on one refusal: `signing_otp_send`'s
            // cooldown, which is a 429 carrying only a countdown because being
            // told to wait is an answer rather than a failure. It still has to
            // travel as a thrown error — `functions.invoke` gives the caller no
            // other route for a non-2xx — so it is given a sentence here.
            const message =
                body?.error ??
                (body?.status === "cooldown"
                    ? "Please wait before requesting another code."
                    : null);

            if (message) {
                const unwrapped = new Error(message) as Signing_Error;
                if (body.missing_fields) {
                    unwrapped.missing_fields = body.missing_fields;
                }
                if (typeof body.retry_after_seconds === "number") {
                    unwrapped.retry_after_seconds = body.retry_after_seconds;
                }
                if (typeof body.attempts_remaining === "number") {
                    unwrapped.attempts_remaining = body.attempts_remaining;
                }
                // [ekyc] THE COPY-ACROSS IS NOT OPTIONAL. This function is the
                // SOLE unwrap point on the signer surface: a structured field
                // that is not copied here is lost silently — no type error, no
                // throw, just a refusal that arrives without the one piece of
                // information that would tell the signer what to fix.
                if (typeof body.reason === "string") {
                    unwrapped.identity_reason = body.reason;
                }
                // The refusals the page has to ACT on rather than print. See
                // `Signing_ErrorCode`.
                if (body.code) unwrapped.code = body.code;
                return unwrapped;
            }
        } catch {
            // Fall through to the original error.
        }
    }
    return error instanceof Error ? error : new Error(String(error));
};
