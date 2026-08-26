/**
 * signing_identity_verify — reads the identity driver's verdict and records it.
 *
 * [ekyc] CG-033. The second half of the identity arm. The signer's browser polls
 * this while the vendor works; `assertSignerIdentity` reads the row it writes.
 *
 * PUBLIC (`verify_jwt = false`, enumerated explicitly in config.toml), and it
 * does not count a use of the token — same three reasons as
 * `signing_identity_start`, and polling makes the first of them sharper: a
 * surface that checks every few seconds would exhaust a signer's 100 uses in
 * minutes.
 *
 * THE CHECK IS SCOPED BY `signer_id` FROM THE TOKEN, NEVER BY A BODY-SUPPLIED
 * `check_id`. Accepting one would let anybody holding any link resolve any other
 * signer's check. There is deliberately no way to name a check from outside.
 *
 * A `pending` VERDICT WRITES NOTHING AND CHAINS NOTHING. Polling is not an
 * evidentiary fact, and `signature_audit_append` takes FOR UPDATE on the
 * request — so a per-poll entry would serialize the whole signing surface
 * against itself. Same argument CG-015 makes for not chaining every redemption.
 *
 * THE SCORE NEVER LEAVES THE SERVER. It is recorded on the row and it is a
 * vendor confidence figure an attacker could tune retries against. The
 * rejection reason does reach the signer, because it is the only thing that
 * tells them what to fix.
 */

import {
    assertCanAct,
    jsonResponse,
    logSignerEvent,
    resolveEffectiveIdentityCheck,
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
} from "../_shared/signerAuth.ts";
import { getIdentityDriver } from "../_shared/signing.ts";

servePublicSigningFunction("signing_identity_verify", async (body, req) => {
    const ctx = await resolveSignerToken(req, body, { countUse: false });
    await assertCanAct(ctx);

    // The twin of `signing_identity_start`'s guard. Repointing only one of the
    // two is the failure this comment exists to stop — a recipient who could
    // start a check but never resolve it holds an unsignable document.
    if (!resolveEffectiveIdentityCheck(ctx)) {
        throw new SignerAuthError(409, "This document does not ask you to verify your identity.");
    }

    const { data: check } = await ctx.admin
        .from("signer_identity_checks")
        .select("id, provider, provider_session_id, status, expires_at")
        .eq("signer_id", ctx.signer.id)
        .eq("status", "pending")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
            id: string;
            provider: string;
            provider_session_id: string;
            status: string;
            expires_at: string | null;
        }>();

    if (!check) {
        // Nothing to resolve. Reported as a status rather than an error because
        // the surface's answer is the same either way — offer the start button —
        // and because distinguishing "never started" from "already resolved"
        // would tell a holder of a leaked link how far the real signer got.
        return jsonResponse({ status: "not_started" }, 200);
    }

    if (check.expires_at && Date.parse(check.expires_at) <= Date.now()) {
        return jsonResponse({ status: "expired", check_id: check.id }, 200);
    }

    const driver = await getIdentityDriver();
    const verdict = await driver.getVerdict(check.provider_session_id);

    if (verdict.status === "pending") {
        // No write, no audit entry. See the header.
        return jsonResponse({ status: "pending", check_id: check.id }, 200);
    }

    const { data: recorded, error } = await ctx.admin
        .rpc("signer_identity_record_verdict", {
            p_check_id: check.id,
            p_status: verdict.status,
            p_score: verdict.score ?? null,
            p_rejection_reason: verdict.rejectionReason ?? null,
            p_ip: ctx.ip,
        })
        .maybeSingle<{
            status: string;
            signer_id: string | null;
            request_id: string | null;
            provider: string | null;
        }>();

    if (error || !recorded) {
        console.error("signer_identity_record_verdict failed:", error);
        throw new SignerAuthError(500, "Could not record the result. Please try again.");
    }

    if (recorded.status === "not_pending") {
        // A race: another poll of the same session resolved it a moment ago. Not
        // an error — the write-once rule worked. Re-read rather than guess.
        const { data: settled } = await ctx.admin
            .from("signer_identity_checks")
            .select("status, rejection_reason")
            .eq("id", check.id)
            .maybeSingle<{ status: string; rejection_reason: string | null }>();

        return jsonResponse(
            {
                status: settled?.status ?? "pending",
                check_id: check.id,
                reason: settled?.status === "rejected" ? settled.rejection_reason : undefined,
            },
            200
        );
    }

    if (recorded.status === "invalid_status") {
        console.error(`identity driver returned an unusable verdict: ${verdict.status}`);
        throw new SignerAuthError(502, "The identity provider gave an answer we could not read.");
    }

    const approved = recorded.status === "approved";

    await logSignerEvent(
        ctx,
        approved ? "signer_identity_verified" : "signer_identity_failed",
        {
            provider: check.provider,
            check_id: check.id,
            // On a rejection only, and truncated by the RPC before it was
            // stored. Never the score.
            reason: approved ? null : (verdict.rejectionReason ?? null),
        },
        {
            methods: ["ekyc"],
            ekyc: {
                provider: check.provider,
                verdict: recorded.status,
                verified_at: new Date().toISOString(),
            },
        }
    );

    return jsonResponse(
        {
            status: recorded.status,
            check_id: check.id,
            reason: approved ? undefined : (verdict.rejectionReason ?? undefined),
        },
        200
    );
});
