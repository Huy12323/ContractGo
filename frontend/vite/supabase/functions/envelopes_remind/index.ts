/**
 * envelopes_remind — the sender's "chase them now", outside the schedule.
 *
 * AUTHENTICATED. Admin or owner of the envelope's organization, via the same
 * `resolveSender` gate as `envelopes_send` / `_void` / `_resend`.
 *
 * ⚠ THIS IS NOT `envelopes_resend`, AND THE UI MUST NOT CONFLATE THEM. They look
 * like the same button and are different acts:
 *
 *   remind — mails a nudge. No token is issued, so the recipient's EXISTING link
 *            keeps working. Nothing is invalidated. Chains `signer_reminded`.
 *   resend — mints a NEW credential, which revokes the old one. The link in the
 *            recipient's inbox stops working. Chains `signer_token_issued` +
 *            `signer_notified`.
 *
 * Remind is for "have you seen this"; resend is for "I lost the email". Offering
 * only resend means every gentle nudge silently breaks a link the recipient may
 * already have open, and offering only remind leaves no way to recover a lost
 * one. Both exist, and `useM_Envelope_Remind` / `useM_Envelope_Resend` say which
 * is which in their success messages.
 *
 * It reminds the CURRENT ORDER only, and reuses `remindSignersAtOrder` — the
 * same function `envelopes_cron_remind` calls. The manual path deliberately does
 * NOT consult `reminder_days`: the sender pressing the button is the schedule,
 * and the counters it writes then push the automatic offsets forward, so a
 * manual chase does not get followed by a robotic one an hour later.
 */

import { jsonResponse } from "../_shared/http.ts";
import { remindSignersAtOrder } from "../_shared/envelopeNotify.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";

serveSenderFunction("envelopes_remind", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "send_documents");
    const envelopeId = String(body.envelope_id ?? "");
    if (!envelopeId) throw new SenderAuthError(400, "envelope_id is required");

    // `loadEnvelopeForSender` is deliberately not used: it selects the columns
    // the void/resend/download paths need and none of the two this one does
    // (`sent_at`, `expires_at`, which the reminder body quotes back to the
    // recipient). The organization filter — the part that actually authorizes —
    // is reproduced verbatim, in the WHERE clause rather than checked after the
    // fetch, so an envelope in another org is indistinguishable from a missing one.
    const { data: envelope, error } = await ctx.admin
        .from("signature_requests")
        .select("id, title, status, current_order, sent_at, expires_at")
        .eq("id", envelopeId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

    if (error) {
        console.error("envelopes_remind: could not load the envelope:", error);
        throw new SenderAuthError(500, "Could not load the document");
    }
    if (!envelope) throw new SenderAuthError(404, "Document not found");

    if (envelope.status !== "in_progress") {
        throw new SenderAuthError(
            409,
            `This document is ${envelope.status}. There is nobody left to remind.`
        );
    }

    const outcomes = await remindSignersAtOrder({
        admin: ctx.admin,
        requestId: envelope.id,
        organizationId: ctx.organizationId,
        organizationName: ctx.organizationName,
        documentTitle: envelope.title,
        order: envelope.current_order,
        sentAt: envelope.sent_at,
        expiresAt: envelope.expires_at,
        actorUserId: ctx.userId,
    });

    if (outcomes.length === 0) {
        // In flight, but nobody at the current order is in a remindable state.
        // The common cause is a signer still `pending` — their invitation never
        // successfully sent, so there is no original link for a reminder to
        // point at, and resend is the action that fixes it. Saying so beats a
        // 200 that reports a successful reminder to nobody.
        throw new SenderAuthError(
            409,
            "Nobody here has an active link to be reminded about. Use Resend link instead."
        );
    }

    const failed = outcomes.filter((outcome) => !outcome.notified);
    if (failed.length > 0) {
        return jsonResponse(
            {
                id: envelope.id,
                status: "partially_reminded",
                reminded: outcomes.filter((o) => o.notified).map((o) => o.signer_email),
                failed: failed.map((o) => o.signer_email),
            },
            207
        );
    }

    return jsonResponse(
        {
            id: envelope.id,
            status: "reminded",
            reminded: outcomes.map((o) => o.signer_email),
        },
        200
    );
});
