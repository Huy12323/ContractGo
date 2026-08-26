/**
 * api_envelopes_void — withdraw a document that is still in flight.
 *
 * The machine counterpart of `envelopes_void`, and it follows that function's
 * ordering exactly, including the part that looks backwards:
 *
 *   REVOKE THE TOKENS FIRST, THEN FLIP THE STATUS.
 *
 * Flipping the status alone leaves every emailed link live. `assertCanAct` would
 * refuse a signature — the request is no longer `in_progress` — but
 * `signing_session_open` would still render the document to anyone holding the
 * link, because opening after the fact is deliberately allowed so a signer can
 * see what they signed. Revocation is what actually closes the door, and doing
 * it first means a failure between the two steps leaves an unreachable document
 * still marked in flight: visibly wrong and fixable by retrying, rather than
 * silently wrong.
 *
 * NO `Idempotency-Key`. Unlike a send, voiding twice is harmless and the second
 * call is answered by the status guard with a 409 naming the current state —
 * which is more useful to a retrying client than a replayed 200 would be.
 */

import { jsonResponse } from "../_shared/http.ts";
import { ApiAuthError, resolveApiClient, serveApiFunction } from "../_shared/apiAuth.ts";
import { loadEnvelopeForSender, logSenderEvent } from "../_shared/senderAuth.ts";
import { notifyEnvelopeSender } from "../_shared/notify.ts";

serveApiFunction("api_envelopes_void", async (body, req) => {
    const ctx = await resolveApiClient(req, String(body.organization_id ?? ""), "send_documents");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 1000) {
        throw new ApiAuthError(400, "invalid_request", "reason must be 1000 characters or fewer");
    }

    if (envelope.status !== "in_progress" && envelope.status !== "draft") {
        throw new ApiAuthError(
            409,
            "invalid_status",
            `This document is ${envelope.status} and can no longer be voided.`
        );
    }

    const { data: revokedCount, error: revokeError } = await ctx.admin.rpc(
        "signer_token_revoke_for_request",
        { p_request_id: envelope.id }
    );
    if (revokeError) {
        console.error("api_envelopes_void: revoke failed:", revokeError);
        throw new ApiAuthError(
            500,
            "internal_error",
            "Could not revoke the signing links. Nothing was changed."
        );
    }

    const { error: statusError } = await ctx.admin
        .from("signature_requests")
        .update({ status: "cancelled" })
        .eq("id", envelope.id)
        // Guards against two callers voiding at once, and against the last signer
        // completing the document between the load above and this write.
        .in("status", ["in_progress", "draft"]);

    if (statusError) {
        console.error("api_envelopes_void: status update failed:", statusError);
        throw new ApiAuthError(500, "internal_error", "Could not void the document");
    }

    // `logSenderEvent` takes a `SenderContext`, which this context IS — so the
    // entry carries `ctx.evidence`, which says `api_client`. Same event type,
    // same payload shape, different actor: a reader of the trail sees one
    // vocabulary regardless of which door the void came in by.
    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        eventType: "request_cancelled",
        payload: { reason: reason || null, previous_status: envelope.status, via: "api" },
    });

    // Only when non-zero: voiding a draft revokes nothing, and an entry saying so
    // would be noise in an evidence trail.
    if (typeof revokedCount === "number" && revokedCount > 0) {
        await logSenderEvent(ctx, {
            envelopeId: envelope.id,
            eventType: "signer_token_revoked",
            payload: { revoked_count: revokedCount, cause: "cancelled" },
        });
    }

    // NO `skipUserId`, and that is the one deliberate difference from
    // `envelopes_void`. There, an admin voiding their own document does not need
    // telling they did it. Here nobody pressed anything: the key's owner may be
    // asleep, and a document withdrawn by an integration is exactly the change to
    // someone's work that nothing else announces.
    await notifyEnvelopeSender({
        admin: ctx.admin,
        requestId: envelope.id,
        organizationId: envelope.organization_id,
        type: "envelope_voided",
        title: `${envelope.title} was voided`,
        body:
            reason ||
            `Voided by the API key "${ctx.apiKeyName}". Every signing link has been revoked.`,
    });

    return jsonResponse({ id: envelope.id, status: "cancelled", revoked_links: revokedCount }, 200);
});
