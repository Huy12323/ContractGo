/**
 * envelopes_draft_create — save a half-composed envelope without sending it.
 *
 * AUTHENTICATED. Admin or owner of the organization, via the same `resolveSender`
 * gate as every other sender-side function.
 *
 * WHY THIS IS AN EDGE FUNCTION AND NOT A `useM_*` WRITING THROUGH POSTGREST — the
 * single constraint that deferred drafts out of v1.0 entirely, and it has not
 * relaxed. `signature_requests.source_pdf_sha256` is NOT NULL and it is EVIDENCE:
 * it is what proves months later that the document burned is the document sent.
 * Computing it in the browser to satisfy a client-side insert would make the
 * client the authority on its own document's identity. So the digest is computed
 * here, from bytes this server reads out of storage — which means even an empty
 * draft has had its PDF fetched and hashed, and a draft cannot exist before a
 * template is chosen.
 *
 * A DRAFT IS A SAVED INTENT, NOT A FROZEN DOCUMENT. It pins a version and stores a
 * snapshot so it can be reopened and previewed, but `envelopes_send` re-resolves
 * the LATEST version at promotion and re-validates everything against it. A
 * template corrected between saving and sending is sent corrected; if the
 * correction moved the roles out from under the saved recipients, promotion
 * refuses and names the mismatch. See that function's header.
 *
 * WHAT IS DELIBERATELY NOT VALIDATED HERE: emails, role coverage, the sender's own
 * required fields, whether the deadline is still in the future. Every one of those
 * is a reason a SEND must fail and none of them is a reason a SAVE should. A save
 * that refuses because the sender has not decided who the second signer is yet has
 * misunderstood the button. `validateForDraft` keeps only what a row cannot be
 * stored or resumed without.
 *
 * THE CHAIN STARTS HERE. `request_created` is appended at draft time, which is
 * when the document came into being; `envelopes_send` appends only `request_sent`
 * when promoting. Subsequent draft EDITS append nothing — there is no
 * `request_updated` in `signature_audit_log_event_type_enum`, and that is the right
 * answer rather than a gap: the chain is the evidence trail of what happened to a
 * document that parties were asked to sign, and nobody has been asked anything yet.
 */

import { jsonResponse } from "../_shared/http.ts";
import { logEnvelopeEvent } from "../_shared/envelopeNotify.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";
import {
    buildSignerRows,
    buildSnapshot,
    type ComposeBody,
    draftTitle,
    firstSignerOrder,
    hashSourcePdf,
    isCc,
    isEmptyRecipient,
    resolveRequireIdentityCheck, // [ekyc]
    resolveSchedule,
    resolveSignerAuth,
    resolveTemplateAndVersion,
    validateForDraft,
} from "../_shared/envelopeCompose.ts";

serveSenderFunction("envelopes_draft_create", async (rawBody, req) => {
    const body = rawBody as unknown as ComposeBody;
    const ctx = await resolveSender(req, String(body?.organization_id ?? ""), "send_documents");
    const { admin, userId } = ctx;

    const validationError = validateForDraft(body);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const resolved = await resolveTemplateAndVersion(admin, body.organization_id, body.template_id);
    const sourcePdfSha256 = await hashSourcePdf(resolved.version.pdf_file_path);

    let schedule;
    try {
        schedule = resolveSchedule(body, {
            defaultExpiryDays: resolved.version.default_expiry_days,
            defaultReminderDays: resolved.version.default_reminder_days,
            sentAt: new Date(),
            // The relative checks only. A draft's deadline is an absolute instant,
            // so one that sits for a month has a deadline in the past through no
            // fault of the data — refusing to save it would trap the sender's own
            // draft. Promotion applies the clock checks and says so.
            strict: false,
        });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
    }

    const recipients = (body.recipients ?? []).filter((r) => !isEmptyRecipient(r));
    const title = draftTitle(body, resolved.template.name);

    const { data: request, error: insertError } = await admin
        .from("signature_requests")
        .insert({
            organization_id: body.organization_id,
            entity_id: resolved.template.entity_id,
            template_id: body.template_id,
            template_version_id: resolved.version.id,
            title,
            source_pdf_r2_key: resolved.version.pdf_file_path,
            source_pdf_sha256: sourcePdfSha256,
            template_snapshot: buildSnapshot(resolved),
            prefilled_values: (body.prefilled_values ?? {}) as Record<string, unknown>,
            status: "draft",
            // A placeholder, not a routing claim: `signature_claim_turn` requires
            // `in_progress`, so nothing reads this while the row is a draft, and
            // promotion overwrites it from the parties it actually sends to.
            // The column is NOT NULL with a CHECK of >= 1, so it needs a value.
            current_order: 1,
            // `sent_at` stays NULL, which is what the list's "Sent" column and
            // `remindSignersAtOrder`'s "sent on" line both read as "not yet".
            sent_at: null,
            expires_at: schedule.expiresAt,
            reminder_days: schedule.reminderDays,
            // CG-031. Saved on the draft so resuming it restores the sender's
            // choice; re-resolved at promotion like everything else, so the send
            // reflects what is on screen rather than what was last autosaved.
            signer_auth: resolveSignerAuth(body),
            require_identity_check: resolveRequireIdentityCheck(body), // [ekyc]
            created_by: userId,
        })
        .select("id")
        .single();

    if (insertError || !request) {
        console.error("Insert draft failed:", insertError);
        throw new SenderAuthError(500, "Could not save the draft.");
    }

    const signerRows = buildSignerRows({
        requestId: request.id as string,
        organizationId: body.organization_id,
        recipients,
        signerRoles: resolved.signerRoles,
    });

    if (signerRows.length > 0) {
        const { error: signersError } = await admin
            .from("signature_request_signers")
            .insert(signerRows);

        if (signersError) {
            console.error("Insert draft signers failed:", signersError);
            // Unlike a send, this is recoverable by simply deleting the row: a
            // draft with no recipients is a legitimate state, but a draft whose
            // recipients silently failed to save would lose the sender's work
            // without telling them.
            await admin.from("signature_requests").delete().eq("id", request.id);
            throw new SenderAuthError(500, "Could not save the recipients.");
        }
    }

    await logEnvelopeEvent(admin, {
        requestId: request.id as string,
        organizationId: body.organization_id,
        signerId: null,
        actorUserId: userId,
        eventType: "request_created",
        payload: {
            template_id: body.template_id,
            template_version_id: resolved.version.id,
            template_version_number: resolved.version.version_number,
            source_pdf_sha256: sourcePdfSha256,
            recipient_count: recipients.length,
            signer_count: recipients.filter((r) => !isCc(r)).length,
            cc_count: recipients.filter(isCc).length,
            prefilled_field_ids: Object.keys(body.prefilled_values ?? {}),
            as_draft: true,
        },
    });

    return jsonResponse(
        {
            id: request.id,
            status: "draft",
            title,
            // Echoed so the composer can tell the sender what was actually kept.
            // A HALF-typed row is kept (a name with no address yet is exactly the
            // state a draft exists to hold — see `buildSignerRows`); only a row
            // with nothing in it at all is dropped, because the "Add observer"
            // button leaves one behind by design.
            recipient_count: signerRows.length,
            first_order: firstSignerOrder(signerRows),
        },
        200
    );
});
