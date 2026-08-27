/**
 * signing_identity_start — opens a government-ID identity check for the signer.
 *
 * [ekyc] CG-033. The first half of the identity arm: this creates the vendor
 * session and the `signer_identity_checks` row, `signing_identity_verify` reads
 * the verdict back, and `assertSignerIdentity` refuses the commit until one is
 * approved.
 *
 * PUBLIC (`verify_jwt = false`, enumerated explicitly in config.toml).
 * `resolveSignerToken` is the mandatory first statement. There is no session to
 * check and there must not be — an identity check is precisely the mechanism for
 * a recipient who has no account.
 *
 * IT DOES NOT COUNT AGAINST THE TOKEN'S USES, for CG-031's two reasons plus a
 * third that is new here:
 *   1. anyone holding a LEAKED link could otherwise call it a hundred times and
 *      lock the real signer out of their own document;
 *   2. the once-per-credential `signer_token_redeemed` entry must attach to a
 *      document being opened, not to a KYC start;
 *   3. with a real vendor each start is BILLABLE, so use-counting would let a
 *      leaked link spend the sender's money as well as their link.
 * The in-statement throttle inside `signer_identity_start` is therefore the ONLY
 * cap on this endpoint. Those two decisions pull in opposite directions on
 * purpose; neither may later be dropped as redundant.
 *
 * FOUR REFUSALS BEFORE A VENDOR IS EVER CALLED, in this order:
 *   1. the token resolves               — `resolveSignerToken`
 *   2. this party may act at all        — `assertCanAct`, which is what stops a
 *                                         CC observer's read-only link starting
 *                                         checks, and stops checks opening on
 *                                         declined, expired or not-yet-your-turn
 *                                         documents
 *   3. this recipient owes a check      — `resolveEffectiveIdentityCheck`
 *   4. the throttle allows it           — inside `signer_identity_start`,
 *                                         atomically, plus the `already_approved`
 *                                         short circuit that stops a resend
 *                                         re-billing a signer who has passed
 *
 * THE REDIRECT URL IS BUILT SERVER-SIDE AND NEVER TAKEN FROM THE BODY. A
 * body-supplied redirect on a `verify_jwt = false` endpoint is an open redirect,
 * and worse, a way to exfiltrate the provider session handle. Same rule and same
 * reason as `signing_otp_send` refusing a body-supplied destination address.
 *
 * THE PROVIDER SESSION ID IS NEVER CHAINED. `signer_identity_started` records
 * the provider and our own `check_id` — the same rule as "never the code" and
 * "never the token": an audit trail containing live handles is a credential
 * store that happens to be append-only.
 *
 * NOTHING HERE AUTO-FIRES. The signer surface must call this from an explicit
 * button press, never on mount. Corporate mail scanners pre-fetch links, and a
 * start-on-open would burn an attempt — and, with a real vendor, a charge — for
 * a robot.
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
import { getSignerPortalUrl } from "../_shared/envelopeNotify.ts";
import { getIdentityDriver } from "../_shared/signing.ts";

/** Mirrors `signer_identity_start`'s `p_ttl_minutes`. Passed explicitly so the
 *  window the driver was told about and the window the database enforces are the
 *  same one. */
const IDENTITY_TTL_MINUTES = 30;

/**
 * A mock that always approves, behind a UI that says "identity verified", is a
 * lie with legal weight. So the mock is allowed only where the deployment SAYS
 * it is a development one.
 *
 * FAILS CLOSED, deliberately unlike `storage.ts`'s `ENVIRONMENT || "development"`.
 * `ENVIRONMENT`'s template default is `development`, so a gate that treats "unset" as
 * development is no gate at all — a production deploy that forgot the variable
 * would silently accept the mock. Requiring an explicit development-ish value
 * inverts that: forgetting refuses, which is the safe direction for a mechanism
 * whose whole job is proving who someone is.
 */
const isDevDeployment = (): boolean =>
    ["development", "local", "test"].includes(Deno.env.get("ENVIRONMENT") ?? "");

servePublicSigningFunction("signing_identity_start", async (body, req) => {
    // `countUse: false` — see the header. First statement all the same: it is
    // what says WHICH signer is asking.
    const ctx = await resolveSignerToken(req, body, { countUse: false });
    await assertCanAct(ctx);

    if (!resolveEffectiveIdentityCheck(ctx)) {
        // Chained, mirroring `otp_not_enabled`: "someone opened an identity check
        // on a document that does not use them" is either a stale tab or a probe,
        // and the second is worth a line in the trail.
        await logSignerEvent(ctx, "signer_access_denied", {
            reason: "identity_check_not_enabled",
        });
        throw new SignerAuthError(409, "This document does not ask you to verify your identity.");
    }

    const driver = await getIdentityDriver();

    if (driver.name === "mock" && !isDevDeployment()) {
        // 502 rather than 500: the identity provider genuinely is not usable, and
        // this is not the signer's fault or something they can retry away. The
        // detail is for the logs; the sentence is what they see.
        throw new SignerAuthError(
            502,
            "Identity verification is not available on this deployment. Please contact the sender.",
            "IDENTITY_DRIVER is the mock and ENVIRONMENT is not a development one"
        );
    }

    const redirectUrl = `${getSignerPortalUrl().replace(/\/+$/, "")}/sign/identity-return`;

    const session = await driver.startSession({
        signerId: ctx.signer.id,
        redirectUrl,
    });

    const { data, error } = await ctx.admin
        .rpc("signer_identity_start", {
            p_token_id: ctx.tokenId,
            p_provider: driver.name,
            p_provider_session_id: session.providerSessionId,
            p_ttl_minutes: IDENTITY_TTL_MINUTES,
            p_ip: ctx.ip,
        })
        .maybeSingle<{
            status: string;
            check_id: string | null;
            expires_at: string | null;
            retry_after_seconds: number | null;
        }>();

    if (error || !data) {
        console.error("signer_identity_start failed:", error);
        throw new SignerAuthError(500, "Could not start the check. Please try again.");
    }

    if (data.status === "already_approved") {
        // Not a refusal. The signer has already passed and must not be
        // re-photographed — or, with a real vendor, re-billed — because a resend
        // handed them a new link. This IS the signer-keyed decision, surfaced.
        return jsonResponse({ status: "approved", check_id: data.check_id }, 200);
    }

    if (data.status === "cooldown") {
        return jsonResponse(
            { status: "cooldown", retry_after_seconds: data.retry_after_seconds ?? 60 },
            429
        );
    }

    if (data.status === "rate_limited") {
        await logSignerEvent(ctx, "signer_access_denied", { reason: "identity_rate_limited" });
        throw new SignerAuthError(
            429,
            "Too many identity checks have been started for this document. Please try again later, or ask the sender to resend it."
        );
    }

    if (data.status !== "started" || !data.check_id) {
        // `invalid_token` lands here. The token resolved a moment ago, so this is
        // a race with a void or a resend rather than a bad link — and it gets the
        // same opaque answer as every other dead-credential case.
        throw new SignerAuthError(401, "This signing link is no longer valid.");
    }

    // NEVER THE PROVIDER SESSION ID. See the header.
    await logSignerEvent(ctx, "signer_identity_started", {
        provider: driver.name,
        check_id: data.check_id,
        expires_at: data.expires_at,
    });

    return jsonResponse(
        {
            status: "pending",
            check_id: data.check_id,
            expires_at: data.expires_at,
            // Where the vendor wants the signer to go. For the mock this is our
            // own return path, which the surface uses as a "continue" affordance
            // rather than a real redirect.
            redirect_url: session.redirectUrl,
            resend_after_seconds: 60,
        },
        200
    );
});
