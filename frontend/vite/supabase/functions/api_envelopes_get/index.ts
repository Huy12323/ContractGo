/**
 * api_envelopes_get — the status of one document.
 *
 * `member` scope: this shows a caller what the sending organization can already
 * list, and requiring `send_documents` to READ would recreate the CG-027 bug
 * where a principal could list a document but not open it.
 *
 * ═══ THE DISCLOSURE SET IS DELIBERATE AND CLOSED ═══
 *
 * `verify_document`'s discipline, applied to an authenticated but non-human
 * caller: what goes out is what the integrator needs to drive a workflow —
 * where the document is, who is holding it up, and the digests that identify the
 * artifacts. What does NOT go out, and must not be added without deciding it
 * again:
 *
 *   - FIELD VALUES. The contents of a signed agreement are not status. An
 *     integration that wants them wants the PDF, which is a separate call with a
 *     separate audit consequence.
 *   - R2 KEYS. They are internal addresses, and one of them is hashed into the
 *     audit chain as an evidentiary anchor (CG-037).
 *   - ROW IDS other than the envelope's own. A signer id is the input to
 *     `api_envelopes_embed-url`, so it IS returned — but token ids, capture ids
 *     and audit entry ids are not, because nothing an integrator does takes them.
 *   - AUDIT PAYLOADS. The trail is evidence with its own access path; a status
 *     endpoint that dribbled it out would be a second, unversioned way to read it.
 */

import { jsonResponse } from "../_shared/http.ts";
import { ApiAuthError, resolveApiClient, serveApiFunction } from "../_shared/apiAuth.ts";

serveApiFunction("api_envelopes_get", async (body, req) => {
    const ctx = await resolveApiClient(req, String(body.organization_id ?? ""), "member");
    const envelopeId = String(body.envelope_id ?? "");

    if (!envelopeId) {
        throw new ApiAuthError(400, "invalid_request", "envelope_id is required");
    }

    // The organization filter is in the WHERE clause rather than checked after
    // the fetch, so a foreign id is indistinguishable from a missing one — a key
    // scoped to org A must not be able to learn that an envelope id exists in
    // org B. `loadEnvelopeForSender` is not reused here because it selects a
    // narrower column set than this endpoint reports.
    const { data: envelope, error } = await ctx.admin
        .from("signature_requests")
        // ONE STRING LITERAL, never a concatenation. supabase-js derives the row
        // type from the select string as a LITERAL TYPE; a `"a" + "b"` expression
        // is not one, so the result silently degrades to `GenericStringError` and
        // every field access below becomes a type error.
        .select(
            "id, title, status, current_order, sent_at, completed_at, expires_at, reminder_days, signer_auth, require_identity_check, template_id, template_version_id, source_pdf_sha256, signed_pdf_sha256, certificate_sha256, certificate_generated_at, created_at"
        )
        .eq("id", envelopeId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

    if (error) {
        console.error("api_envelopes_get: lookup failed:", error);
        throw new ApiAuthError(500, "internal_error", "Could not load the document");
    }
    if (!envelope) {
        throw new ApiAuthError(404, "not_found", "Document not found");
    }

    const { data: signers, error: signersError } = await ctx.admin
        .from("signature_request_signers")
        .select(
            "id, recipient_type, role_id, signer_order, signer_name, signer_email, status, notified_at, viewed_at, signed_at, decline_reason, changes_requested_reason, reminder_count, last_reminded_at"
        )
        .eq("request_id", envelopeId)
        .order("signer_order", { ascending: true })
        .order("signer_name", { ascending: true });

    if (signersError) {
        console.error("api_envelopes_get: signers lookup failed:", signersError);
        throw new ApiAuthError(500, "internal_error", "Could not load the recipients");
    }

    // Derived, not stored — `Page_Envelopes` derives the same fact from the same
    // two columns rather than keeping a third copy that can go stale between
    // them. An integrator polling for "who am I waiting on" is asking exactly
    // what the sender's list answers, and the two must not disagree.
    const waitingOn =
        envelope.status === "in_progress"
            ? (signers ?? [])
                  .filter(
                      (s) =>
                          s.recipient_type === "signer" &&
                          s.signer_order === envelope.current_order &&
                          s.status !== "signed"
                  )
                  .map((s) => ({ id: s.id, name: s.signer_name, email: s.signer_email }))
            : [];

    return jsonResponse(
        {
            id: envelope.id,
            title: envelope.title,
            status: envelope.status,
            current_order: envelope.current_order,
            created_at: envelope.created_at,
            sent_at: envelope.sent_at,
            completed_at: envelope.completed_at,
            expires_at: envelope.expires_at,
            reminder_days: envelope.reminder_days,
            signer_auth: envelope.signer_auth,
            require_identity_check: envelope.require_identity_check, // [ekyc]
            template_id: envelope.template_id,
            template_version_id: envelope.template_version_id,
            // The three artifact digests. `source` always exists; the other two
            // are null until the document completes and until a certificate is
            // issued respectively. They are also the input to the PUBLIC
            // verification page, so an integrator can hand a counterparty a way
            // to check the document without involving us.
            source_pdf_sha256: envelope.source_pdf_sha256,
            signed_pdf_sha256: envelope.signed_pdf_sha256,
            certificate_sha256: envelope.certificate_sha256,
            certificate_generated_at: envelope.certificate_generated_at,
            waiting_on: waitingOn,
            recipients: (signers ?? []).map((s) => ({
                id: s.id,
                type: s.recipient_type,
                role_id: s.role_id,
                order: s.signer_order,
                name: s.signer_name,
                email: s.signer_email,
                status: s.status,
                notified_at: s.notified_at,
                viewed_at: s.viewed_at,
                signed_at: s.signed_at,
                // Both reasons are returned verbatim. They are the evidence of
                // why a route ended or looped, the chain hashed them as written,
                // and an API that paraphrased them would disagree with the
                // certificate.
                decline_reason: s.decline_reason,
                changes_requested_reason: s.changes_requested_reason,
                reminder_count: s.reminder_count,
                last_reminded_at: s.last_reminded_at,
            })),
        },
        200
    );
});
