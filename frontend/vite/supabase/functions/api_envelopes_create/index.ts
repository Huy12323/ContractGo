/**
 * api_envelopes_create — send a document, from a program.
 *
 * PUBLIC to the Supabase gateway (`verify_jwt = false`, enumerated in
 * config.toml) because the caller carries no Supabase JWT. It is NOT
 * unauthenticated: `resolveApiClient` is the mandatory first statement and the
 * whole of the authorization, exactly as `resolveSignerToken` is for the signer
 * surface and `assertCronSecret` is for the schedulers.
 *
 * ═══ THE BODY IS `ComposeBody`, VERBATIM ═══
 *
 * The same shape the composer posts to `envelopes_send`, plus nothing. An
 * integrator and the UI must be able to send the same JSON — the moment the API
 * gets its own request shape, the two surfaces need translating between and the
 * translation is where they diverge. The one thing NOT accepted is
 * `envelope_id`: promoting a draft is a UI operation on a UI artifact, and an
 * API caller composing a document has nothing to promote.
 *
 * ═══ WHY THIS IS A SECOND ORCHESTRATION AND NOT A CALL INTO `envelopes_send` ═══
 *
 * v1.4.0 is additive-only, and `envelopes_send` is on the untouched list: it has
 * been smoke-tested end to end in five phases, and the alternative design —
 * teaching it a second auth mode — was explicitly rejected because it edits the
 * most-verified sender path.
 *
 * So the two agree by IMPORTING THE SAME FUNCTIONS in the same order rather than
 * by sharing a call stack: `resolveTemplateAndVersion` → `validateForSend` →
 * `resolveSchedule` → `hashSourcePdf` → `buildRequestRow` → `buildSignerRows` →
 * `firstSignerOrder` → `logEnvelopeEvent` → `notifySignersAtOrder`. Every
 * decision with judgement in it lives in `_shared/envelopeCompose.ts`; what is
 * below is plumbing.
 *
 * IF YOU CHANGE THE SEND PIPELINE, CHANGE IT IN BOTH. The list of things that
 * must stay in step is exactly: the order of the calls above, the row built by
 * `buildRequestRow` (shared, and unit-tested), and the two chain entries
 * `request_created` and `request_sent`.
 *
 * ═══ THE ROW IS INSERTED WITH `created_by` = THE KEY'S OWNER ═══
 *
 * See CG-044's header. `resolveSenderEmail` walks `created_by → profiles.email`
 * to mail the sender on decline and expiry, so a NULL there silently drops those
 * notifications. The chain still says a machine acted — `ctx.evidence.actor.kind`
 * is `api_client` — so both facts are recorded and neither is invented.
 */

import { jsonResponse } from "../_shared/http.ts";
import {
    ApiAuthError,
    claimIdempotency,
    resolveApiClient,
    serveApiFunction,
} from "../_shared/apiAuth.ts";
import { logEnvelopeEvent, notifySignersAtOrder } from "../_shared/envelopeNotify.ts";
import {
    buildRequestRow,
    buildSignerRows,
    type ComposeBody,
    firstSignerOrder,
    hashSourcePdf,
    isCc,
    isEmptyRecipient,
    resolveRequireIdentityCheck, // [ekyc]
    resolveSchedule,
    resolveSignerAuth,
    resolveTemplateAndVersion,
    validateForSend,
} from "../_shared/envelopeCompose.ts";

serveApiFunction("api_envelopes_create", async (rawBody, req) => {
    // ---- 1. authenticate + authorize ----------------------------------
    const body = rawBody as unknown as ComposeBody;
    const ctx = await resolveApiClient(req, String(body?.organization_id ?? ""), "send_documents");
    const { admin, organizationName, userId, organizationId } = ctx;

    if (!body?.template_id) {
        throw new ApiAuthError(400, "template_id_required", "template_id is required");
    }
    if ("envelope_id" in (rawBody ?? {})) {
        throw new ApiAuthError(
            400,
            "envelope_id_not_supported",
            "envelope_id is not supported by the API — drafts are a UI concept"
        );
    }

    // ---- 2. claim the idempotency key ---------------------------------
    // BEFORE any work and before any write. A retry that arrives while the first
    // call is still resolving the template must be told "in flight", not sent a
    // second contract.
    const idem = await claimIdempotency(ctx, req, "api_envelopes_create", rawBody);
    if (idem.shortCircuit) return idem.shortCircuit;

    // ---- 3. pin the version -------------------------------------------
    const resolved = await resolveTemplateAndVersion(admin, organizationId, body.template_id);

    // ---- 4. validate ---------------------------------------------------
    const shapeError = validateForSend({
        body,
        layout: resolved.layout,
        signerRoles: resolved.signerRoles,
    });
    if (shapeError) {
        // `validateForSend` returns structured detail (`missing_fields`) that the
        // composer uses to highlight boxes. An integrator wants the same detail
        // for the same reason, so it is passed through rather than flattened.
        const response = jsonResponse({ ...shapeError, code: "invalid_request" }, 400);
        await idem.complete(400, { ...shapeError, code: "invalid_request" });
        return response;
    }

    const sentAt = new Date();
    let schedule;
    let signerAuth;
    try {
        schedule = resolveSchedule(body, {
            defaultExpiryDays: resolved.version.default_expiry_days,
            defaultReminderDays: resolved.version.default_reminder_days,
            sentAt,
            strict: true,
        });
        signerAuth = resolveSignerAuth(body);
    } catch (err) {
        const failure = { error: (err as Error).message, code: "invalid_request" };
        await idem.complete(400, failure);
        return jsonResponse(failure, 400);
    }

    // ---- 5. hash the source PDF ----------------------------------------
    // Read through the storage driver and hashed HERE, never supplied by the
    // caller. The client is not the authority on its own document's identity —
    // that digest is what proves months later that the document burned is the
    // document sent.
    const sourcePdfSha256 = await hashSourcePdf(resolved.version.pdf_file_path);

    // ---- 6. write request + signers -------------------------------------
    const recipients = (body.recipients ?? []).filter((r) => !isEmptyRecipient(r));
    const requireIdentityCheck = resolveRequireIdentityCheck(body); // [ekyc]
    const title = body.title!.trim();

    const row = buildRequestRow({
        body,
        resolved,
        schedule,
        signerAuth,
        requireIdentityCheck,
        sourcePdfSha256,
        sentAt,
    });

    const { data: inserted, error: insertError } = await admin
        .from("signature_requests")
        .insert({ ...row, current_order: 1, created_by: userId })
        .select("id")
        .single();

    if (insertError || !inserted) {
        console.error("api_envelopes_create: insert request failed:", insertError);
        throw new ApiAuthError(500, "internal_error", "Could not create the signature request");
    }
    const requestId = inserted.id as string;

    const signerRows = buildSignerRows({
        requestId,
        organizationId,
        recipients,
        signerRoles: resolved.signerRoles,
    });
    const firstOrder = firstSignerOrder(signerRows);

    const { error: signersError } = await admin
        .from("signature_request_signers")
        .insert(signerRows);

    if (signersError) {
        console.error("api_envelopes_create: insert signers failed:", signersError);
        // The request row exists but has no parties, so it can never progress.
        // Delete it rather than leaving an unreachable envelope in the list —
        // `envelopes_send` makes the same call for the same reason.
        await admin.from("signature_requests").delete().eq("id", requestId);
        throw new ApiAuthError(500, "internal_error", "Could not add the recipients");
    }

    // Written AFTER the signers exist, because until they do there is no order to
    // point at.
    const { error: orderError } = await admin
        .from("signature_requests")
        .update({ current_order: firstOrder })
        .eq("id", requestId);

    if (orderError) {
        console.error("api_envelopes_create: setting current_order failed:", orderError);
        throw new ApiAuthError(500, "internal_error", "Could not start the routing");
    }

    const signingParties = recipients.filter((r) => !isCc(r));
    const ccParties = recipients.filter(isCc);

    // The same two entries, with the same payloads, that a composer send writes.
    // `ctx.evidence` is what makes them say `api_client` rather than `sender` —
    // the payload shape is identical, only the actor differs, so a reader of the
    // trail sees one vocabulary regardless of which door the document came in by.
    await logEnvelopeEvent(admin, {
        requestId,
        organizationId,
        signerId: null,
        actorUserId: userId,
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
            // The one payload key a composer send does not write. An integrator
            // reading their own audit trail needs to know which key sent a
            // document — the actor block names it too, but this is the field a
            // consumer filters on.
            via: "api",
        },
    });

    await logEnvelopeEvent(admin, {
        requestId,
        organizationId,
        signerId: null,
        actorUserId: userId,
        actorEvidence: ctx.evidence,
        eventType: "request_sent",
        payload: {
            title,
            first_order: firstOrder,
            expires_at: schedule.expiresAt,
            reminder_days: schedule.reminderDays,
            template_version_id: resolved.version.id,
            template_version_number: resolved.version.version_number,
            promoted_from_draft: false,
            signer_auth: signerAuth,
            require_identity_check: requireIdentityCheck, // [ekyc]
            via: "api",
        },
    });

    // ---- 7. notify --------------------------------------------------------
    const outcomes = await notifySignersAtOrder({
        admin,
        requestId,
        organizationId,
        organizationName,
        documentTitle: title,
        order: firstOrder,
        actorUserId: userId,
        actorEvidence: ctx.evidence,
    });

    // CC observers are copied on COMPLETION, by `finalizeRequest`. The composer's
    // per-recipient "copy me now too" toggle is UI state that is deliberately not
    // persisted, so there is nothing for an API caller to set and no
    // notify-on-send branch here.
    const failed = outcomes.filter((o) => !o.notified);

    const responseBody = {
        id: requestId,
        status: failed.length > 0 ? "sent_with_delivery_failures" : "sent",
        notified: outcomes.filter((o) => o.notified).map((o) => o.signer_email),
        ...(failed.length > 0 ? { failed: failed.map((o) => o.signer_email) } : {}),
    };
    const status = failed.length > 0 ? 207 : 201;

    // Recorded BEFORE the response is returned, so a retry that arrives a
    // millisecond later replays this answer instead of re-entering the send path.
    await idem.complete(status, responseBody);
    return jsonResponse(responseBody, status);
});
