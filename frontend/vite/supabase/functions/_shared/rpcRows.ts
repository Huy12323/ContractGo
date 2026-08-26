/**
 * Row shapes returned by the `RETURNS TABLE` RPCs the edge functions call.
 *
 * WHY THIS FILE EXISTS. Every edge function builds its client with a bare
 * `createClient(url, key)` — no `Database` generic — because the generated
 * `src/types/database.types.ts` lives in the Vite app and the functions are a
 * separate Deno program with its own import map. An untyped client types every
 * `.rpc()` result as `{}`, so `issued.token` is a type error at each of the two
 * dozen sites that read one. Until `check:ef` was made real (v1.2.0 Phase A)
 * nothing ran the compiler over this half of the repo, so none of them surfaced.
 *
 * These declarations are transcribed from `database.types.ts` — regenerate that
 * with `pnpm sb:dev:types` and re-check here when an RPC signature changes.
 * They are types only: annotating `.maybeSingle<T>()` / `.single<T>()` emits
 * nothing and changes no behaviour.
 *
 * NOT a substitute for the generated types. If the functions ever gain access to
 * `Database`, delete this file and pass the generic instead — a hand-maintained
 * mirror is a thing that drifts.
 */

/** `signer_token_issue(p_signer_id, p_purpose, p_ttl_hours)` */
export type Rpc_SignerTokenIssue = {
    /** The plaintext token. Emailed, never stored, never logged. */
    token: string;
    token_id: string;
    expires_at: string;
};

/** `signer_token_redeem(p_token_hash, p_ip, p_count_use)` */
export type Rpc_SignerTokenRedeem = {
    token_id: string;
    signer_id: string;
    request_id: string;
    organization_id: string;
    purpose: "sign" | "view";
    /** POST-increment (CG-015): first use is 1. */
    use_count: number;
    /**
     * Nullable in the database — the generated types flatten `RETURNS TABLE`
     * columns to non-null, which is wrong here and would hide a missing guard.
     */
    otp_verified_at: string | null;
};

/** `signer_otp_issue(p_token_id, p_ttl_minutes, p_ip)` */
export type Rpc_SignerOtpIssue = {
    status: string;
    challenge_id: string | null;
    /** Only ever returned to the driver. Never logged, never sent to the client. */
    code: string | null;
    expires_at: string | null;
    retry_after_seconds: number | null;
};

/** `signer_otp_verify(p_token_id, p_code, p_ip)` */
export type Rpc_SignerOtpVerify = {
    status: string;
    attempts_remaining: number | null;
};

/** `signer_ai_message_begin(p_token_id, p_question, p_ip)` — CG-049. */
export type Rpc_SignerAiMessageBegin = {
    /**
     * ok | invalid_token | disabled | cooldown | rate_limited | turn_limit
     * | org_quota | global_quota
     *
     * `org_quota` and `global_quota` are separate values here and the SAME
     * answer on the wire: the caller must not be able to tell whether another
     * tenant's usage is what stopped them.
     */
    status: string;
    session_id: string | null;
    /** Non-null only on `ok`. The handle for complete/fail. */
    message_id: string | null;
    turn_index: number | null;
    turns_remaining: number | null;
    retry_after_seconds: number | null;
};
