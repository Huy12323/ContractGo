/**
 * envelopes_draft_update — re-save a draft.
 *
 * AUTHENTICATED. Admin or owner of the organization.
 *
 * REPLACES WHOLESALE rather than patching. The body is the draft's new content in
 * full: title, recipients, pre-filled values, schedule. A patch protocol would
 * need a way to say "remove this recipient" that is distinguishable from "I did
 * not mention them", and the composer holds the entire composition in local state
 * anyway — it has nothing partial to send.
 *
 * IT ALSO RE-RESOLVES THE TEMPLATE, every time, even when `template_id` has not
 * changed. The version, the snapshot and the source hash are all re-derived from
 * whatever the template says now. That is not laziness: a colleague can replace
 * the source PDF in the builder between two saves, and a draft still carrying the
 * previous digest would be a row whose `source_pdf_sha256` describes bytes that
 * are no longer at `source_pdf_r2_key` — a broken preview at best, and at worst a
 * hash that silently means nothing. The digest always describes bytes this server
 * just read.
 *
 * ONLY A DRAFT CAN BE UPDATED, and the status predicate is in the WHERE clause
 * rather than checked after a fetch. A sent envelope is not editable by anyone at
 * any privilege level: its recipients hold live links to a snapshot they have
 * already been shown, and rewriting it underneath them would change the document
 * someone is part-way through signing. The database agrees independently — the
 * signer-row UPDATE and DELETE policies allow only `pending` rows — but this
 * function runs as service_role, which RLS does not apply to, so the predicate
 * here is the whole of the guard.
 */

import { jsonResponse } from "../_shared/http.ts";
import {
    logSenderEvent,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";
import {
    buildSignerRows,
    buildSnapshot,
    type ComposeBody,
    draftTitle,
    hashSourcePdf,
    isEmptyRecipient,
    resolveRequireIdentityCheck, // [ekyc]
    mergeScheduleDefaults,
    resolveSchedule,
    resolveSignerAuth,
    resolveTemplateAndVersion,
    validateForDraft,
} from "../_shared/envelopeCompose.ts";

type DraftUpdateBody = ComposeBody & { envelope_id: string };

serveSenderFunction("envelopes_draft_update", async (rawBody, req) => {
    const body = rawBody as unknown as DraftUpdateBody;
    const ctx = await resolveSender(req, String(body?.organization_id ?? ""), "send_documents");
    // `admin` is taken for the writes; the rest of `ctx` is used for the audit
    // entry at the end. `ctx.userId` still never reaches `created_by` — see the
    // note in the UPDATE below. The two are different questions: who AUTHORED this
    // draft, and who EDITED it just now. The chain answers the second.
    const { admin } = ctx;

    const envelopeId = typeof body.envelope_id === "string" ? body.envelope_id : "";
    if (!envelopeId) throw new SenderAuthError(400, "envelope_id is required");

    const validationError = validateForDraft(body);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    // The organization filter is in the WHERE clause, so a draft belonging to
    // another organization is indistinguishable from a missing one — an authorized
    // admin of org A must not be able to learn that an envelope id exists in org B.
    // The pre-edit state is read as well as the status, because CG-016 chains a
    // `request_updated` entry and an entry that only records the NEW state cannot
    // answer the question it exists for — "what did this colleague change?".
    const { data: existing, error: loadError } = await admin
        .from("signature_requests")
        .select(
            "id, status, created_by, title, template_id, template_version_id, prefilled_values, expires_at, signer_auth, require_identity_check"
        )
        .eq("id", envelopeId)
        .eq("organization_id", body.organization_id)
        .maybeSingle();

    if (loadError) {
        console.error("envelopes_draft_update: could not load the draft:", loadError);
        throw new SenderAuthError(500, "Could not load the draft");
    }
    if (!existing) throw new SenderAuthError(404, "Draft not found");
    if (existing.status !== "draft") {
        throw new SenderAuthError(
            409,
            `This document is ${existing.status} and can no longer be edited. Its recipients already have it.`
        );
    }

    const resolved = await resolveTemplateAndVersion(admin, body.organization_id, body.template_id);
    const sourcePdfSha256 = await hashSourcePdf(resolved.version.pdf_file_path);

    let schedule;
    try {
        schedule = resolveSchedule(body, {
            ...mergeScheduleDefaults(resolved.version, ctx.organization),
            sentAt: new Date(),
            strict: false,
        });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
    }

    let signerAuth;
    let requireIdentityCheck; // [ekyc]
    try {
        signerAuth = resolveSignerAuth(body, ctx.organization.default_signer_auth);
        requireIdentityCheck = resolveRequireIdentityCheck(body); // [ekyc]
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 400);
    }

    const recipients = (body.recipients ?? []).filter((r) => !isEmptyRecipient(r));
    const title = draftTitle(body, resolved.template.name);

    // Guarded on `status = 'draft'` AGAIN, with a read-back, even though it was
    // just checked above. The check and the write are separate round trips, and in
    // between them a colleague can press Send: PostgREST reports success for an
    // UPDATE that matched no rows, so without the `.select()` this would answer 200
    // having quietly failed to save — or worse, would have rewritten a document
    // that had already gone out.
    const { data: updated, error: updateError } = await admin
        .from("signature_requests")
        .update({
            entity_id: resolved.template.entity_id,
            template_id: body.template_id,
            template_version_id: resolved.version.id,
            title,
            source_pdf_r2_key: resolved.version.pdf_file_path,
            source_pdf_sha256: sourcePdfSha256,
            template_snapshot: buildSnapshot(resolved),
            prefilled_values: (body.prefilled_values ?? {}) as Record<string, unknown>,
            expires_at: schedule.expiresAt,
            reminder_days: schedule.reminderDays,
            signer_auth: signerAuth,
            require_identity_check: requireIdentityCheck, // [ekyc]
            // `created_by` is untouched: whoever started this draft created the
            // document, and a colleague saving it does not become its author.
        })
        .eq("id", envelopeId)
        .eq("organization_id", body.organization_id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();

    if (updateError) {
        console.error("envelopes_draft_update failed:", updateError);
        throw new SenderAuthError(500, "Could not save the draft.");
    }
    if (!updated) {
        throw new SenderAuthError(
            409,
            "This draft was sent or deleted while you were editing it. Reload to see where it got to."
        );
    }

    // Read for the audit entry only, before the rows are replaced. This is the
    // one moment the previous recipient list exists — the delete below is
    // unconditional — and "who was on this document before it was edited" is
    // exactly what a `request_updated` entry has to be able to say.
    const { data: previousSigners } = await admin
        .from("signature_request_signers")
        .select("signer_email, signer_name, signer_phone, role_id, recipient_type")
        .eq("request_id", envelopeId);

    // Replace, don't reconcile. A draft's signer rows carry no tokens, no captures
    // and no history — nothing references them — so a diff would be comparison code
    // protecting nothing. The delete is scoped by `request_id`, and the row it
    // belongs to has just been proven to be a draft in this organization.
    const { error: clearError } = await admin
        .from("signature_request_signers")
        .delete()
        .eq("request_id", envelopeId);

    if (clearError) {
        console.error("Clearing draft signers failed:", clearError);
        throw new SenderAuthError(500, "Could not update the recipients.");
    }

    const signerRows = buildSignerRows({
        requestId: envelopeId,
        organizationId: body.organization_id,
        recipients,
        signerRoles: resolved.signerRoles,
    });

    if (signerRows.length > 0) {
        const { error: signersError } = await admin
            .from("signature_request_signers")
            .insert(signerRows);

        if (signersError) {
            // The recipients are now GONE from the row and could not be put back —
            // this reports honestly rather than claiming a save. The composer still
            // holds them in local state, so the sender's next save recovers them;
            // saying "saved" here would be the one outcome they could not recover
            // from, because they would stop trying.
            console.error("Insert draft signers failed:", signersError);
            throw new SenderAuthError(
                500,
                "The draft was saved but its recipients were not. Press save again."
            );
        }
    }

    // CHAINED, as of CG-016. This function used to argue the opposite — "nobody
    // has been asked anything yet", so edits between creation and sending were
    // nobody's evidence. That holds for the signing CEREMONY and fails for the
    // document: a draft is created by one colleague and can be re-titled, re-
    // templated, re-scheduled and re-addressed by another before it goes out, and
    // a trail that begins at `request_sent` cannot show who changed the terms. It
    // also cannot show that the version sent was not the version approved.
    //
    // Recorded as a BEFORE/AFTER pair over the fields a sender can actually move,
    // plus the list of which ones moved. The pair rather than a prose diff because
    // the payload is hashed: "title changed" is unfalsifiable later, whereas the
    // two values are checkable against each other and against the next entry.
    //
    // Recipient phone numbers are in both lists deliberately. They are
    // identification evidence for the parties, and a silent change to the number
    // an OTP will be sent to is precisely the edit a trail must not lose.
    // BOTH SIDES SORTED THE SAME WAY before they are compared or recorded. The
    // previous list comes back in whatever order Postgres chose and the new one
    // follows the composer's role order, so an unsorted comparison would report
    // "recipients changed" on a save that changed nothing — and a trail that
    // cries wolf on every autosave is a trail nobody reads.
    const byIdentity = (a: { recipient_type: string; email: string }, b: typeof a) =>
        a.recipient_type.localeCompare(b.recipient_type) || a.email.localeCompare(b.email);

    const previousRecipients = (previousSigners ?? [])
        .map((s) => ({
            name: s.signer_name,
            email: s.signer_email,
            phone: s.signer_phone,
            role_id: s.role_id,
            recipient_type: s.recipient_type,
        }))
        .sort(byIdentity);
    const currentRecipients = signerRows
        .map((s) => ({
            name: s.signer_name,
            email: s.signer_email,
            phone: s.signer_phone ?? null,
            role_id: s.role_id,
            recipient_type: s.recipient_type,
        }))
        .sort(byIdentity);

    const changed: string[] = [];
    if ((existing.title ?? "") !== title) changed.push("title");
    if (existing.template_id !== body.template_id) changed.push("template");
    if (existing.template_version_id !== resolved.version.id) changed.push("template_version");
    // Compared as INSTANTS, not as strings. PostgREST hands back
    // `2026-09-01T00:00:00+00:00` while `resolveSchedule` produces
    // `2026-09-01T00:00:00.000Z`; the same moment in two spellings would log a
    // deadline change on every save that changed nothing.
    const instantOf = (value: string | null | undefined): number | null =>
        value ? new Date(value).getTime() : null;
    if (instantOf(existing.expires_at) !== instantOf(schedule.expiresAt)) {
        changed.push("expires_at");
    }
    // Key order differs between what jsonb returns and what the composer sent, so
    // the comparison is over sorted entries rather than raw JSON text.
    const canonical = (value: unknown): string =>
        JSON.stringify(Object.entries((value ?? {}) as Record<string, unknown>).sort());
    if (canonical(existing.prefilled_values) !== canonical(body.prefilled_values)) {
        changed.push("prefilled_values");
    }
    if (JSON.stringify(previousRecipients) !== JSON.stringify(currentRecipients)) {
        changed.push("recipients");
    }
    // CG-031. Belongs in the diff for the reason the whole diff exists: this is
    // one of the terms of the document, and switching a draft from "recipients
    // sign in" to "anyone with the emailed code can sign" is precisely the kind
    // of change a trail beginning at `request_sent` would be unable to show.
    if ((existing.signer_auth ?? "account") !== signerAuth) {
        changed.push("signer_auth");
    }

    // [ekyc] CG-033, for the same reason: switching a draft from "sign straight
    // from the email" to "photograph a government ID first" is a term of the
    // document, and a sender who did not expect it should be able to see who
    // changed it and when.
    if ((existing.require_identity_check ?? false) !== requireIdentityCheck) {
        changed.push("require_identity_check");
    }

    // An edit that changed nothing is still an access to the document, but it is
    // not an edit, and writing one entry per autosave would bury the real changes
    // in noise. The chain records changes; `signer_access_denied` and the token
    // events record attention.
    if (changed.length > 0) {
        await logSenderEvent(ctx, {
            envelopeId,
            eventType: "request_updated",
            payload: {
                changed,
                before: {
                    title: existing.title,
                    template_id: existing.template_id,
                    template_version_id: existing.template_version_id,
                    expires_at: existing.expires_at,
                    signer_auth: existing.signer_auth ?? "account",
                    require_identity_check: existing.require_identity_check ?? false, // [ekyc]
                    prefilled_field_ids: Object.keys(
                        (existing.prefilled_values ?? {}) as Record<string, unknown>
                    ),
                    recipients: previousRecipients,
                },
                after: {
                    title,
                    template_id: body.template_id,
                    template_version_id: resolved.version.id,
                    template_version_number: resolved.version.version_number,
                    expires_at: schedule.expiresAt,
                    signer_auth: signerAuth,
                    require_identity_check: requireIdentityCheck, // [ekyc]
                    prefilled_field_ids: Object.keys(body.prefilled_values ?? {}),
                    recipients: currentRecipients,
                },
                // The bytes, before and after. A template swap changes the document
                // itself, and the digest is the only field that proves which one the
                // draft now points at.
                source_pdf_sha256: sourcePdfSha256,
            },
        });
    }

    return jsonResponse(
        {
            id: envelopeId,
            status: "draft",
            title,
            recipient_count: signerRows.length,
            // Echoed because it may have MOVED since the last save: this function
            // re-resolves the latest version every time, so a colleague saving the
            // builder is visible to a sender who is watching for it.
            template_version_number: resolved.version.version_number,
        },
        200
    );
});
