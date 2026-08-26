/**
 * signing_otp_verify — the signer answers the code.
 *
 * The redemption half of CG-031's `email_otp` mode. On success it stamps
 * `signer_access_tokens.otp_verified_at`, which is what `assertSignerIdentity`
 * reads when the signer goes on to submit or decline. This function does not
 * itself authorise anything — it records that a mailbox was demonstrated, and
 * the acting endpoints judge that record against a freshness window.
 *
 * PUBLIC (`verify_jwt = false`, enumerated explicitly in config.toml).
 * `resolveSignerToken` is the mandatory first statement, and — as in
 * `signing_otp_send` — it deliberately does not spend one of the token's uses:
 * a signer who mistypes twice must not be burning through their own link, and a
 * holder of a leaked one must not be able to exhaust it. See `countUse`.
 *
 * ALL THE DECIDING HAPPENS IN ONE SQL STATEMENT, inside `signer_otp_verify`. The
 * attempt counter is incremented by the same UPDATE that tests the hash, so
 * parallel guesses cannot exceed the cap. Doing the comparison here — read the
 * row, check the code, write the counter — would hand an attacker as many
 * guesses as they can open sockets, which is the one attack a six-digit code is
 * genuinely vulnerable to. This file is transport and audit; it is not logic.
 *
 * WRONG AND EXPIRED ARE ONE ANSWER. `signer_otp_verify` distinguishes them so
 * the audit chain can, but the response does not: telling an anonymous caller
 * whether a code merely aged out would confirm that a real one was issued and
 * when. `locked` IS surfaced, because there the correct advice differs — ask for
 * a new code rather than try again — and it reveals nothing a caller who just
 * spent five attempts does not already know.
 */

import {
    assertCanAct,
    jsonResponse,
    logSignerEvent,
    resolveEffectiveSignerAuth,
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
} from "../_shared/signerAuth.ts";
import type { Rpc_SignerOtpVerify } from "../_shared/rpcRows.ts";

servePublicSigningFunction("signing_otp_verify", async (body, req) => {
    const ctx = await resolveSignerToken(req, body, { countUse: false });
    await assertCanAct(ctx);

    // PER RECIPIENT SINCE CG-032 — the twin of `signing_otp_send`'s guard.
    // Repointing only one of the two is the failure this comment exists to stop.
    if (resolveEffectiveSignerAuth(ctx) !== "email_otp") {
        throw new SignerAuthError(
            409,
            "This document is signed by signing in to a ContractGo account, not with an emailed code."
        );
    }

    // Trimmed because people paste from mail clients that add whitespace, and
    // rejecting " 123456" would be a refusal the signer cannot see the cause of.
    // Nothing else is normalised: the code is digits, and a caller sending
    // anything else is not a signer having a bad day.
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!/^[0-9]{6}$/.test(code)) {
        // Refused WITHOUT touching the attempt counter, deliberately. A
        // malformed value was never a guess at the code, and letting it consume
        // an attempt would give anyone holding the link a way to burn a signer's
        // five tries without ever guessing anything.
        throw new SignerAuthError(400, "Enter the six-digit code from your email.");
    }

    const { data, error } = await ctx.admin
        .rpc("signer_otp_verify", {
            p_token_id: ctx.tokenId,
            p_code: code,
            p_ip: ctx.ip,
        })
        .maybeSingle<Rpc_SignerOtpVerify>();

    if (error || !data) {
        console.error("signer_otp_verify failed:", error);
        throw new SignerAuthError(500, "Could not check your code. Please try again.");
    }

    if (data.status === "verified") {
        await logSignerEvent(ctx, "signer_otp_verified", { channel: "email" });
        return jsonResponse({ status: "verified" }, 200);
    }

    // Every failure is chained. Repeated wrong codes on one document are the
    // only signal anybody gets that a link has left the hands it was sent to,
    // and the sender reads that signal on the audit trail.
    await logSignerEvent(ctx, "signer_otp_failed", {
        reason: data.status,
        attempts_remaining: data.attempts_remaining,
    });

    if (data.status === "locked") {
        throw new SignerAuthError(
            429,
            "Too many incorrect codes. Request a new one to try again.",
            "attempt cap reached",
            "otp_required"
        );
    }

    // 'invalid' and 'expired' collapse here. `attempts_remaining` is returned
    // because it tells the signer something true and actionable about their own
    // situation — and it is zero for the expired case, which is consistent with
    // "ask for another" being the advice in both.
    return jsonResponse(
        {
            status: "invalid",
            attempts_remaining: data.attempts_remaining ?? 0,
            error: "That code is not right, or it has expired. Check the latest email, or request a new code.",
        },
        400
    );
});
