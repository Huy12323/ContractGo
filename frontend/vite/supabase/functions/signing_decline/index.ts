/**
 * signing_decline — a party refuses to sign, and the route ends.
 *
 * PUBLIC (`verify_jwt = false`, enumerated explicitly in config.toml);
 * `resolveSignerToken` is the mandatory first statement, `assertCanAct` the
 * second and `assertSignerIdentity` the third, exactly as in `signing_submit`. A
 * decline stands in for the signature, so it is authenticated to the same
 * standard as the signature: the emailed link to say which signer, and whichever
 * identity proof the sender chose (CG-031) to say that it is really them.
 *
 * "THE SAME STANDARD" IS THE WHOLE POINT AND NOT A CONVENIENCE. Gating the
 * signature but not the decline would mean the cheapest way to attack a document
 * is to destroy it rather than to forge it — and destroying it is the act that
 * harms every OTHER party too. The two functions must move together forever.
 *
 * A DECLINE KILLS THE WHOLE DOCUMENT, not just the decliner's turn. There is no
 * such thing as a contract that three of four parties agreed to: if one party
 * refuses, the others' signatures are on an instrument that will not exist, and
 * leaving the request in flight would keep asking the remaining parties for
 * signatures that can no longer complete anything. So the request goes
 * `declined` and every token on it is revoked — including the co-signers' live
 * links, which are the actual door.
 *
 * ORDER OF OPERATIONS, and why it is this order:
 *
 *   1. signer   — the decline itself, as a conditional UPDATE. This is the
 *                 evidence, and it is written before anything derived from it.
 *                 Conditional so two clicks, or a click racing a signature,
 *                 cannot both take effect.
 *   2. request  — terminal status, guarded on `in_progress` for the same reason.
 *   3. revoke   — the links die. Deliberately AFTER the status, unlike
 *                 `envelopes_void`: there, revocation is the only thing closing
 *                 the door, because a voided request has no per-signer record of
 *                 why. Here `assertCanAct` already refuses every path into
 *                 signing the moment step 2 lands, so revocation is defence in
 *                 depth rather than the mechanism, and evidence goes first.
 *   4. chain    — `signer_declined`, with the reason in the hashed payload.
 *   5. consume  — this token is spent.
 *   6. mail     — the sender learns. Non-fatal: a decline that reached the
 *                 database is done whether or not the mail provider is up.
 */

import {
    assertCanAct,
    assertSignerIdentity,
    jsonResponse,
    logSignerEvent,
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
    type SignerContext,
} from "../_shared/signerAuth.ts";
import { notifySenderOfDecline } from "../_shared/envelopeNotify.ts";

/** Long enough to say why, short enough that the mail body and the hashed audit
 *  payload stay bounded. The chain hashes this string verbatim. */
const MAX_REASON_LENGTH = 1000;

servePublicSigningFunction("signing_decline", async (body, req) => {
    const ctx = await resolveSignerToken(req, body);
    await assertCanAct(ctx);
    // Held to the same identity requirement as `signing_submit`, and for a
    // stronger reason: a decline kills the document for EVERY party, so the one
    // action a stray link-holder could take that harms everyone else must not be
    // the one action that is left ungated.
    await assertSignerIdentity(ctx, req);

    // A required reason is not a form nicety. "Declined" with no explanation
    // tells the sender nothing they can act on, and the reason is the only part
    // of this transition that carries information rather than just state — which
    // is why it goes into the hashed payload rather than a column the chain
    // does not cover.
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
        throw new SignerAuthError(400, "Please give a reason for declining.");
    }
    if (reason.length > MAX_REASON_LENGTH) {
        throw new SignerAuthError(
            400,
            `Please keep the reason under ${MAX_REASON_LENGTH} characters.`
        );
    }

    // ---- 1. signer -----------------------------------------------------
    // `.select()` makes this a read of what the write actually did: PostgREST
    // reports success for an UPDATE that matched no rows, so without it a
    // decline racing a signature would return 200 having changed nothing.
    const { data: declined, error: declineError } = await ctx.admin
        .from("signature_request_signers")
        .update({
            status: "declined",
            decline_reason: reason,
        })
        .eq("id", ctx.signer.id)
        // The same states `assertCanAct` permits. Re-stated here because the
        // check and the write are separate round trips, and only the write is
        // atomic with respect to a concurrent signature.
        .in("status", ["notified", "viewed"])
        .select("id")
        .maybeSingle();

    if (declineError) {
        console.error("Recording the decline failed:", declineError);
        throw new SignerAuthError(500, "Could not record your decision. Please try again.");
    }
    if (!declined) {
        throw new SignerAuthError(
            409,
            "This document has changed since you opened it. Please reload the page."
        );
    }

    // ---- 2. request ----------------------------------------------------
    const { error: requestError } = await ctx.admin
        .from("signature_requests")
        .update({ status: "declined" })
        .eq("id", ctx.request.id)
        // Guards against the last co-signer completing the document between the
        // load and this write. If that happened, the signer row above is still
        // `declined` and visibly disagrees with a completed request — a
        // contradiction the sender can see and resolve, which is strictly better
        // than silently un-completing a burned and signed artifact.
        .eq("status", "in_progress");

    if (requestError) {
        console.error("Closing the declined request failed:", requestError);
        throw new SignerAuthError(500, "Could not close the document. Please try again.");
    }

    // ---- 3. revoke -----------------------------------------------------
    const { data: revokedCount, error: revokeError } = await ctx.admin.rpc(
        "signer_token_revoke_for_request",
        { p_request_id: ctx.request.id }
    );
    if (revokeError) {
        // Not fatal: step 2 already made every signing path refuse. Loud,
        // because the co-signers' links can still OPEN the document until this
        // succeeds, and that is a state someone should notice.
        console.error("Revoking tokens after a decline failed:", revokeError);
    }

    // ---- 4. chain ------------------------------------------------------
    await logSignerEvent(ctx, "signer_declined", {
        reason,
        signer_order: ctx.signer.signer_order,
        role_id: ctx.signer.role_id,
    });

    // A decline kills every link on the document, not just the decliner's, and
    // how many co-signers were cut off is a fact about what this decline DID.
    // Chained only when the count is non-zero, matching
    // `envelopes_request-changes`: an entry claiming a revocation that revoked
    // nothing is a claim about evidence rather than evidence. The count is
    // available at all because CG-015 made this RPC return one.
    if (typeof revokedCount === "number" && revokedCount > 0) {
        await logSignerEvent(ctx, "signer_token_revoked", {
            revoked_count: revokedCount,
            cause: "declined",
        });
    }

    // ---- 5. consume ----------------------------------------------------
    await ctx.admin.rpc("signer_token_consume", { p_token_id: ctx.tokenId });

    // ---- 6. mail -------------------------------------------------------
    await notifySender(ctx, reason);

    return jsonResponse({ status: "declined" }, 200);
});

/**
 * Never throws. The decline is recorded, revoked and chained by the time this
 * runs; telling the signer their decision failed because a mail server was
 * unreachable would invite them to click Decline again on a document that is
 * already closed.
 */
async function notifySender(ctx: SignerContext, reason: string): Promise<void> {
    try {
        const { data: request } = await ctx.admin
            .from("signature_requests")
            .select("created_by")
            .eq("id", ctx.request.id)
            .maybeSingle();

        const detail = await notifySenderOfDecline({
            admin: ctx.admin,
            requestId: ctx.request.id,
            organizationId: ctx.request.organization_id,
            documentTitle: ctx.request.title,
            createdBy: request?.created_by ?? null,
            signerName: ctx.signer.signer_name,
            signerEmail: ctx.signer.signer_email,
            reason,
        });

        if (detail) console.error("Notifying the sender of the decline failed:", detail);
    } catch (err) {
        console.error("Notifying the sender of the decline threw:", err);
    }
}
