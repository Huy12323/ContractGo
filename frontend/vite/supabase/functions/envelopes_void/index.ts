/**
 * envelopes_void — the sender withdraws a document that is still in flight.
 *
 * AUTHENTICATED. Admin or owner of the envelope's organization.
 *
 * "Void", not "delete". The row stays, the audit chain stays, and the status
 * becomes `cancelled` — a document someone was asked to sign and then was not is
 * a fact about what happened, and destroying it would destroy the evidence that
 * the request was ever made. The RLS DELETE policy allows removal only while
 * `draft` for the same reason.
 *
 * REVOKING THE TOKENS IS THE POINT. Flipping the status alone would leave every
 * emailed link live: `assertCanAct` would reject a signature (the request is no
 * longer `in_progress`), but `signing_session_open` would still render the
 * document to anyone holding the link, because opening is deliberately allowed
 * after the fact so a signer can see what they signed. Revocation is what
 * actually closes the door.
 */

import { jsonResponse } from "../_shared/http.ts";
import { notifyEnvelopeSender } from "../_shared/notify.ts";
import {
    loadEnvelopeForSender,
    logSenderEvent,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";

serveSenderFunction("envelopes_void", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "send_documents");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    // A completed document cannot be un-completed: it has been signed, the
    // signed artifact exists and is hashed, and the signers relied on it. A
    // declined one is already terminal.
    if (envelope.status !== "in_progress" && envelope.status !== "draft") {
        throw new SenderAuthError(
            409,
            `This document is ${envelope.status} and can no longer be voided.`
        );
    }

    // Revoke FIRST. If the status update failed after revocation the document is
    // unreachable but still marked in flight — visibly wrong and fixable by
    // retrying. The reverse order leaves live links on a voided document, which
    // is silently wrong.
    const { data: revokedCount, error: revokeError } = await ctx.admin.rpc(
        "signer_token_revoke_for_request",
        { p_request_id: envelope.id }
    );
    if (revokeError) {
        console.error("signer_token_revoke_for_request failed:", revokeError);
        throw new SenderAuthError(500, "Could not revoke the signing links. Nothing was changed.");
    }

    const { error: statusError } = await ctx.admin
        .from("signature_requests")
        .update({ status: "cancelled" })
        .eq("id", envelope.id)
        // Guards against two senders voiding at once, and against the last
        // signer completing the document between the load above and this write.
        .in("status", ["in_progress", "draft"]);

    if (statusError) {
        console.error("Voiding the request failed:", statusError);
        throw new SenderAuthError(500, "Could not void the document.");
    }

    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        eventType: "request_cancelled",
        payload: { reason: reason || null, previous_status: envelope.status },
    });

    // Revocation is the mechanism here rather than defence in depth — see the
    // header — so how many live links it actually killed is the substance of
    // what voiding did, and belongs on the chain rather than only in the void
    // entry's prose. Chained after `request_cancelled` because it is a
    // consequence of the void, and only when non-zero: voiding a draft revokes
    // nothing, and an entry saying so would be noise in an evidence trail.
    if (typeof revokedCount === "number" && revokedCount > 0) {
        await logSenderEvent(ctx, {
            envelopeId: envelope.id,
            eventType: "signer_token_revoked",
            payload: { revoked_count: revokedCount, cause: "cancelled" },
        });
    }

    // CG-018, app-only. `skipUserId` is the whole point here: an admin voiding
    // their own document does not need to be told they did it, but an admin
    // voiding a COLLEAGUE'S document is a change to someone else's work that
    // nothing else in the system announces.
    await notifyEnvelopeSender({
        admin: ctx.admin,
        requestId: envelope.id,
        organizationId: envelope.organization_id,
        type: "envelope_voided",
        title: `${envelope.title} was voided`,
        body: reason || "Every signing link for this document has been revoked.",
        skipUserId: ctx.userId,
    });

    return jsonResponse({ id: envelope.id, status: "cancelled" }, 200);
});
