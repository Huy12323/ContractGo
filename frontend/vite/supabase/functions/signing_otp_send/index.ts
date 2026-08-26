/**
 * signing_otp_send — emails the signer a one-time passcode.
 *
 * The delivery half of CG-031's `email_otp` mode: on an envelope whose sender
 * chose "recipients sign straight from the email", this is what a signer calls
 * before committing, and `signing_otp_verify` is what they call after reading
 * their inbox.
 *
 * PUBLIC (`verify_jwt = false`, enumerated explicitly in config.toml).
 * `resolveSignerToken` is the mandatory first statement. There is no session to
 * check and there must not be — the entire point of this mode is that the
 * recipient has no account.
 *
 * IT DOES NOT COUNT AGAINST THE TOKEN'S USES, and that is a security property
 * rather than an economy. `signer_token_redeem` normally spends one of
 * `max_uses` (100) per call; if this did too, anyone holding a LEAKED link could
 * call it a hundred times and permanently lock the real signer out of their own
 * document. See `resolveSignerToken`'s `countUse`.
 *
 * FOUR REFUSALS BEFORE A SINGLE MAIL IS SENT, in this order:
 *
 *   1. the token resolves            — `resolveSignerToken`
 *   2. this party may act at all     — `assertCanAct`, which is what stops a CC
 *                                      observer's read-only link from minting
 *                                      passcodes, and stops codes going out for
 *                                      declined, expired or not-yet-your-turn
 *                                      documents
 *   3. this envelope uses passcodes  — `signer_auth = 'email_otp'`. On an
 *                                      `account` envelope a passcode would be a
 *                                      second, weaker identity mechanism running
 *                                      beside the one the sender deliberately
 *                                      chose. Fail closed.
 *   4. the throttle allows it        — inside `signer_otp_issue`, atomically
 *
 * THE DESTINATION IS NEVER TAKEN FROM THE BODY. It is read from
 * `signature_request_signers.signer_email`, the address the sender addressed the
 * document to. A body-supplied recipient on a `verify_jwt = false` endpoint would
 * be a code-forwarding oracle for anyone holding a link.
 *
 * NOTHING HERE AUTO-FIRES. The signer surface must call this from an explicit
 * button press, never on mount: corporate mail scanners pre-fetch links (see
 * `_shared/signerAuth.ts`'s header), so a send-on-open would turn every scanner
 * and every page reload into an email.
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
import type { Rpc_SignerOtpIssue } from "../_shared/rpcRows.ts";
import { getOtpDriver } from "../_shared/signing.ts";

/** Mirrors `signer_otp_issue`'s `p_ttl_minutes`. Passed explicitly rather than
 *  left to the default so the number in the email and the number in the database
 *  are the same one. */
const OTP_TTL_MINUTES = 10;

servePublicSigningFunction("signing_otp_send", async (body, req) => {
    // `countUse: false` — see the header. This must be the first statement all
    // the same: it is what says WHICH signer is asking.
    const ctx = await resolveSignerToken(req, body, { countUse: false });
    await assertCanAct(ctx);

    // PER RECIPIENT SINCE CG-032, and this guard and `signing_otp_verify`'s copy
    // must agree with `assertSignerIdentity` or a signer excepted onto
    // `email_otp` passes the gate's passcode arm while both passcode endpoints
    // refuse to issue them one — an unsignable document with no error they can
    // act on.
    const effectiveAuth = resolveEffectiveSignerAuth(ctx);

    if (effectiveAuth !== "email_otp") {
        // Chained, because "someone asked for a passcode on a document that does
        // not use passcodes" is either a stale tab or a probe, and the second is
        // worth a line in the trail.
        await logSignerEvent(ctx, "signer_access_denied", {
            reason: "otp_not_enabled",
            signer_auth: effectiveAuth,
        });
        throw new SignerAuthError(
            409,
            "This document is signed by signing in to a ContractGo account, not with an emailed code."
        );
    }

    const { data, error } = await ctx.admin
        .rpc("signer_otp_issue", {
            p_token_id: ctx.tokenId,
            p_ttl_minutes: OTP_TTL_MINUTES,
            p_ip: ctx.ip,
        })
        .maybeSingle<Rpc_SignerOtpIssue>();

    if (error || !data) {
        console.error("signer_otp_issue failed:", error);
        throw new SignerAuthError(500, "Could not send your code. Please try again.");
    }

    if (data.status === "cooldown") {
        // The one refusal that is not a failure. It is answered with a countdown
        // rather than an apology, and 429 is what the surface branches on to
        // start it.
        return jsonResponse(
            {
                status: "cooldown",
                retry_after_seconds: data.retry_after_seconds ?? 60,
            },
            429
        );
    }

    if (data.status === "rate_limited") {
        await logSignerEvent(ctx, "signer_access_denied", { reason: "otp_rate_limited" });
        throw new SignerAuthError(
            429,
            "Too many codes have been requested for this document. Please try again later, or ask the sender to resend it."
        );
    }

    if (data.status !== "sent" || !data.code) {
        // `invalid_token` lands here. The token resolved a moment ago, so this
        // is a race with a void or a resend rather than a bad link — and it gets
        // the same opaque answer as every other dead-credential case.
        throw new SignerAuthError(401, "This signing link is no longer valid.");
    }

    // The organization's name, for a message that has to identify itself. A
    // passcode from an unnamed sender is indistinguishable from a scam.
    const { data: org } = await ctx.admin
        .from("organizations")
        .select("name")
        .eq("id", ctx.request.organization_id)
        .maybeSingle();

    try {
        const driver = await getOtpDriver();
        await driver.send({
            destination: ctx.signer.signer_email,
            code: data.code,
            documentTitle: ctx.request.title,
            signerName: ctx.signer.signer_name,
            organizationName: org?.name ?? "ContractGo",
            expiresInMinutes: OTP_TTL_MINUTES,
        });
    } catch (err) {
        // A challenge now exists that the signer will never be able to answer,
        // and the cooldown would block their retry for a minute. Expiring it
        // immediately is what lets them press the button again at once.
        console.error("OTP delivery failed; expiring the challenge:", err);
        await ctx.admin
            .from("signer_otp_challenges")
            .update({ expires_at: new Date().toISOString() })
            .eq("id", data.challenge_id);

        throw new SignerAuthError(
            502,
            "We could not send your code just now. Please try again in a moment."
        );
    }

    // NEVER THE CODE. Same rule as `signer_token_issued`, which records a token's
    // id and not the token: an audit trail that contains live credentials is a
    // credential store that happens to be append-only.
    await logSignerEvent(ctx, "signer_otp_issued", {
        channel: "email",
        challenge_id: data.challenge_id,
        expires_at: data.expires_at,
    });

    return jsonResponse(
        {
            status: "sent",
            expires_at: data.expires_at,
            // So the surface can start its resend countdown from the same number
            // the database will enforce, rather than from a constant of its own.
            resend_after_seconds: 60,
        },
        200
    );
});
