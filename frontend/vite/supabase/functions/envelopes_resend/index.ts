/**
 * envelopes_resend — send the signing link again to whoever it is waiting on.
 *
 * AUTHENTICATED. Admin or owner of the envelope's organization.
 *
 * This is one line of real work wrapped in authorization, because
 * `notifySignersAtOrder` already does exactly the right thing: it mints a fresh
 * token (revoking the previous live one, so the old link dies rather than
 * leaving two valid credentials), emails it, and chains `signer_token_issued` +
 * `signer_notified`. A resend and an original send are therefore the same event
 * on the audit trail, which is what makes "how many times was this person
 * chased" answerable.
 *
 * It resends to the CURRENT ORDER only. Mailing a later party would give them a
 * link that `assertCanAct` refuses — an invitation to an error page — and
 * mailing an earlier one would chase someone who has already signed.
 */

import { jsonResponse } from "../_shared/http.ts";
import { notifySignersAtOrder } from "../_shared/envelopeNotify.ts";
import {
    loadEnvelopeForSender,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";

serveSenderFunction("envelopes_resend", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "send_documents");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    if (envelope.status !== "in_progress") {
        throw new SenderAuthError(
            409,
            `This document is ${envelope.status}. There is nobody left to remind.`
        );
    }

    const outcomes = await notifySignersAtOrder({
        admin: ctx.admin,
        requestId: envelope.id,
        organizationId: ctx.organizationId,
        organizationName: ctx.organizationName,
        documentTitle: envelope.title,
        order: envelope.current_order,
        actorUserId: ctx.userId,
        actorEvidence: ctx.evidence,
    });

    if (outcomes.length === 0) {
        // In flight, but nobody at the current order is in a notifiable state.
        // That is a routing inconsistency rather than a user error — surfacing
        // it as a 409 beats reporting a successful send to nobody.
        throw new SenderAuthError(
            409,
            "There is no recipient waiting at this step. Reload the document."
        );
    }

    const failed = outcomes.filter((outcome) => !outcome.notified);
    if (failed.length > 0) {
        return jsonResponse(
            {
                id: envelope.id,
                status: "partially_sent",
                notified: outcomes.filter((o) => o.notified).map((o) => o.signer_email),
                failed: failed.map((o) => o.signer_email),
            },
            207
        );
    }

    return jsonResponse(
        { id: envelope.id, status: "sent", notified: outcomes.map((o) => o.signer_email) },
        200
    );
});
