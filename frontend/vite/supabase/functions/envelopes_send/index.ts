/**
 * envelopes_send — turns a template into a live signature request.
 *
 * AUTHENTICATED (`verify_jwt` defaults to true; deliberately NOT listed in the
 * public block of config.toml). The caller is an admin or owner of the
 * organization; the people it emails are not users at all.
 *
 * TWO MODES, one pipeline:
 *
 *   create  — no `envelope_id`. Inserts the request and its signers, then sends.
 *   promote — `envelope_id` names an existing DRAFT (Phase G). Updates that row
 *             in place and REPLACES its signers, then sends.
 *
 * The modes differ in five lines near the end. Everything before that — resolving
 * and pinning the version, hashing the PDF, validating against the pinned layout,
 * resolving the schedule — is identical by construction, because it is the same
 * `_shared/envelopeCompose.ts` calls in the same order. That is the point: a draft
 * must not be sendable through a path that checks less than a fresh send does.
 *
 * PROMOTION TAKES ITS CONTENT FROM THE BODY, NOT FROM THE DRAFT ROW. The composer
 * sends what is currently on screen, and the draft row supplies only the identity
 * to reuse. The alternative — promote whatever was last saved — makes the send
 * button's meaning depend on whether an autosave landed, which is exactly the
 * class of bug that gets the wrong document sent to a counterparty.
 *
 * WHY THE VERSION IS RE-PINNED AT PROMOTION rather than kept from draft time: a
 * draft is a saved INTENT, not a frozen document. Sending on Wednesday a template
 * that was corrected on Tuesday should send Tuesday's correction — and if the
 * correction moved the roles or the fields out from under the saved recipients,
 * `validateForSend` refuses and names the mismatch instead of silently sending
 * either the stale document or a broken one.
 *
 * ORDER OF OPERATIONS:
 *   1. authenticate + authorize   — admin/owner of this organization
 *   2. pin the version            — latest `contract_template_versions` row
 *   3. validate                   — roles mapped, sender fields filled, PDF present
 *   4. hash the source PDF        — read through the storage driver
 *   5. write request + signers    — insert, or promote the named draft
 *   6. notify the first order     — mint tokens, send mail, mark notified
 *
 * Steps 5–6 are not one transaction (PostgREST gives each call its own). The
 * ordering is chosen so the failure modes are all forward-recoverable: a request
 * that exists but reached nobody is visible and resendable, whereas mail sent for
 * a request that failed to write would be a live link to nothing.
 */

import type { SupabaseClient } from "supabase";
import { jsonResponse } from "../_shared/http.ts";
import {
    logEnvelopeEvent,
    notifyCcRecipients,
    notifySignersAtOrder,
} from "../_shared/envelopeNotify.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";
import {
    buildSignerRows,
    buildSnapshot,
    type ComposeBody,
    firstSignerOrder,
    hashSourcePdf,
    isCc,
    isEmptyRecipient,
    resolveRequireIdentityCheck, // [ekyc]
    mergeScheduleDefaults,
    resolveSchedule,
    resolveSignerAuth,
    resolveTemplateAndVersion,
    validateForSend,
} from "../_shared/envelopeCompose.ts";

type SendBody = ComposeBody & {
    /** Promote this draft instead of inserting a new row. */
    envelope_id?: string;
};

serveSenderFunction("envelopes_send", async (rawBody, req) => {
    // ---- 1. authenticate + authorize --------------------------------
    const body = rawBody as unknown as SendBody;
    const ctx = await resolveSender(req, String(body?.organization_id ?? ""), "send_documents");
    const { admin, organizationName, userId } = ctx;

    const draftId = typeof body.envelope_id === "string" ? body.envelope_id : null;

    if (!body?.template_id) return jsonResponse({ error: "template_id is required" }, 400);

    // ---- 2. pin the version -----------------------------------------
    const resolved = await resolveTemplateAndVersion(admin, body.organization_id, body.template_id);

    // ---- 3. validate --------------------------------------------------
    const shapeError = validateForSend({
        body,
        layout: resolved.layout,
        signerRoles: resolved.signerRoles,
    });
    if (shapeError) return jsonResponse(shapeError, 400);

    const sentAt = new Date();
    let schedule;
    try {
        schedule = resolveSchedule(body, {
            ...mergeScheduleDefaults(resolved.version, ctx.organization),
            sentAt,
            // The full clock checks. A stale draft whose deadline has passed is
            // refused HERE and not at save time — see `resolveSchedule`'s note.
            strict: true,
        });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
    }

    // Resolved alongside the schedule and refused the same way — an
    // unrecognised value is a 400 with a sentence, not a 500 from an enum
    // constraint three writes later.
    let signerAuth;
    try {
        signerAuth = resolveSignerAuth(body, ctx.organization.default_signer_auth);
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
    }

    // ---- 4. hash the source PDF ---------------------------------------
    const sourcePdfSha256 = await hashSourcePdf(resolved.version.pdf_file_path);

    // ---- 5. write request + signers -----------------------------------
    const recipients = (body.recipients ?? []).filter((r) => !isEmptyRecipient(r));
    const title = body.title!.trim();

    const row = {
        organization_id: body.organization_id,
        entity_id: resolved.template.entity_id,
        template_id: body.template_id,
        template_version_id: resolved.version.id,
        title,
        source_pdf_r2_key: resolved.version.pdf_file_path,
        source_pdf_sha256: sourcePdfSha256,
        template_snapshot: buildSnapshot(resolved),
        prefilled_values: (body.prefilled_values ?? {}) as Record<string, unknown>,
        status: "in_progress" as const,
        sent_at: sentAt.toISOString(),
        // All three are absolute facts about THIS send. None is ever re-read
        // from the template afterwards — a template corrected next week must not
        // retroactively change this document's deadline or how it may be signed.
        expires_at: schedule.expiresAt,
        reminder_days: schedule.reminderDays,
        signer_auth: signerAuth,
        require_identity_check: resolveRequireIdentityCheck(body), // [ekyc]
    };

    const requestId = draftId
        ? await promoteDraft({ admin, draftId, organizationId: body.organization_id, row })
        : await insertRequest({ admin, row, userId });

    // Replacing rather than reconciling. A draft's signer rows carry no tokens, no
    // captures and no history — nothing references them — so a diff would be a
    // pile of comparison code protecting nothing. `signature_request_signers`'
    // DELETE policy allows only `pending` rows, which is exactly this case, and
    // this runs as service_role anyway.
    if (draftId) {
        const { error: clearError } = await admin
            .from("signature_request_signers")
            .delete()
            .eq("request_id", requestId);
        if (clearError) {
            console.error("Clearing draft signers failed:", clearError);
            throw new SenderAuthError(500, "Could not update the recipients.");
        }
    }

    const signerRows = buildSignerRows({
        requestId,
        organizationId: body.organization_id,
        recipients,
        signerRoles: resolved.signerRoles,
    });
    const firstOrder = firstSignerOrder(signerRows);

    const { data: insertedSigners, error: signersError } = await admin
        .from("signature_request_signers")
        .insert(signerRows)
        .select("id, signer_email, recipient_type");

    if (signersError || !insertedSigners) {
        console.error("Insert signers failed:", signersError);
        if (draftId) {
            // Put it back where it was rather than deleting someone's draft. Its
            // signers are gone, which the composer's own state can restore on the
            // next save — losing the row entirely could not be undone.
            await admin
                .from("signature_requests")
                .update({ status: "draft", sent_at: null })
                .eq("id", requestId);
        } else {
            // The request row exists but has no parties, so it can never
            // progress. Delete it rather than leaving an unreachable envelope in
            // the list.
            await admin.from("signature_requests").delete().eq("id", requestId);
        }
        throw new SenderAuthError(500, "Could not add the recipients.");
    }

    // `current_order` is written AFTER the signers exist, because until they do
    // there is no order to point at. On a fresh insert this is the second write to
    // a row nobody can see yet; on a promotion it is what makes the routing
    // pointer agree with the parties that just replaced the draft's.
    const { error: orderError } = await admin
        .from("signature_requests")
        .update({ current_order: firstOrder })
        .eq("id", requestId);

    if (orderError) {
        console.error("Setting current_order failed:", orderError);
        throw new SenderAuthError(500, "Could not start the routing.");
    }

    const signingParties = recipients.filter((r) => !isCc(r));
    const ccParties = recipients.filter(isCc);

    // On a promotion `request_created` is already on the chain from
    // `envelopes_draft_create`, and appending a second one would claim the
    // document was created twice.
    if (!draftId) {
        await logEnvelopeEvent(admin, {
            requestId,
            organizationId: body.organization_id,
            signerId: null,
            actorUserId: userId,
            // The sender's own captured identity and session assurance, so every
            // entry this send writes names a person, not a UUID (CG-016).
            actorEvidence: ctx.evidence,
            eventType: "request_created",
            payload: {
                template_id: body.template_id,
                template_version_id: resolved.version.id,
                template_version_number: resolved.version.version_number,
                source_pdf_sha256: sourcePdfSha256,
                recipient_count: recipients.length,
                signer_count: signingParties.length,
                cc_count: ccParties.length,
                prefilled_field_ids: Object.keys(body.prefilled_values ?? {}),
            },
        });
    }

    await logEnvelopeEvent(admin, {
        requestId,
        organizationId: body.organization_id,
        signerId: null,
        actorUserId: userId,
        actorEvidence: ctx.evidence,
        eventType: "request_sent",
        payload: {
            title,
            first_order: firstOrder,
            expires_at: schedule.expiresAt,
            reminder_days: schedule.reminderDays,
            // The version actually sent, which on a promotion may differ from the
            // one the draft was saved against. Recording it here is what makes
            // "was this the version I reviewed" answerable from the chain.
            template_version_id: resolved.version.id,
            template_version_number: resolved.version.version_number,
            promoted_from_draft: !!draftId,
            // CG-031. THE fact a dispute turns on: what this sender required of
            // the people who signed. It is on the request row too, but a column
            // is current state and this is the hashed record of what was decided
            // at the moment of sending — the row could be migrated, the chain
            // entry cannot be edited without breaking verification.
            signer_auth: signerAuth,
            require_identity_check: resolveRequireIdentityCheck(body), // [ekyc]
        },
    });

    // ---- 6. notify ------------------------------------------------------
    const outcomes = await notifySignersAtOrder({
        admin,
        requestId,
        organizationId: body.organization_id,
        organizationName,
        documentTitle: title,
        order: firstOrder,
        actorUserId: userId,
        actorEvidence: ctx.evidence,
    });

    // Observers who asked to be copied at send time. The rest are copied when the
    // document COMPLETES, which `signing_submit` does after the burn — the
    // finished artifact is the one worth observing, and a copy of something that
    // is later declined is a copy of nothing.
    const ccOnSendEmails = new Set(
        ccParties.filter((r) => r.notify_on_send).map((r) => r.email.toLowerCase().trim())
    );
    const ccOnSendIds = insertedSigners
        .filter((s) => s.recipient_type === "cc" && ccOnSendEmails.has(s.signer_email))
        .map((s) => s.id);

    const ccOutcomes = ccOnSendIds.length
        ? await notifyCcRecipients({
              admin,
              requestId,
              organizationId: body.organization_id,
              organizationName,
              documentTitle: title,
              stage: "sent",
              actorUserId: userId,
              actorEvidence: ctx.evidence,
              ccSignerIds: ccOnSendIds,
          })
        : [];

    const failed = [...outcomes, ...ccOutcomes].filter((o) => !o.notified);

    // 207 rather than 500: the request IS sent and the audit chain says so.
    // Reporting failure would invite the sender to send a second envelope for the
    // same document, which is worse than one delivery to retry.
    if (failed.length > 0) {
        return jsonResponse(
            {
                id: requestId,
                status: "sent_with_delivery_failures",
                notified: [...outcomes, ...ccOutcomes]
                    .filter((o) => o.notified)
                    .map((o) => o.signer_email),
                failed: failed.map((o) => o.signer_email),
            },
            207
        );
    }

    return jsonResponse(
        {
            id: requestId,
            status: "sent",
            notified: [...outcomes, ...ccOutcomes].map((o) => o.signer_email),
        },
        200
    );
});

// ============================================================
// The two ways a row comes to be in_progress
// ============================================================

async function insertRequest(args: {
    admin: SupabaseClient;
    row: Record<string, unknown>;
    userId: string;
}): Promise<string> {
    const { data, error } = await args.admin
        .from("signature_requests")
        .insert({ ...args.row, current_order: 1, created_by: args.userId })
        .select("id")
        .single();

    if (error || !data) {
        console.error("Insert signature_request failed:", error);
        throw new SenderAuthError(500, "Could not create the signature request.");
    }
    return data.id as string;
}

/**
 * Flips a draft to `in_progress`, overwriting its content with this send's.
 *
 * THE STATUS PREDICATE IS THE LOCK. `.eq("status", "draft")` plus a read-back is
 * what stops two clicks (or two tabs) both promoting the same draft and both
 * going on to email the recipients: the second matches zero rows. PostgREST
 * reports success for an UPDATE that changed nothing, which is why the
 * `.select()` is not optional — the same lesson `signing_decline` and
 * `envelopes_cron_expire` are built on.
 *
 * `created_by` is deliberately NOT overwritten: the draft's author created this
 * document, and a colleague pressing send does not become its author. Who sent it
 * is on the chain's `request_sent` entry, which carries the acting user.
 */
async function promoteDraft(args: {
    admin: SupabaseClient;
    draftId: string;
    organizationId: string;
    row: Record<string, unknown>;
}): Promise<string> {
    const { data, error } = await args.admin
        .from("signature_requests")
        .update(args.row)
        .eq("id", args.draftId)
        .eq("organization_id", args.organizationId)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();

    if (error) {
        console.error("Promote draft failed:", error);
        throw new SenderAuthError(500, "Could not send this draft.");
    }
    if (!data) {
        // Missing, another organization's, or no longer a draft — and the three
        // are deliberately one answer. A 404 that distinguished them would let an
        // admin of one organization probe for envelope ids in another.
        throw new SenderAuthError(
            409,
            "This draft could not be sent. It may have been deleted, or already sent from another tab."
        );
    }
    return data.id as string;
}
