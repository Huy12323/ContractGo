/**
 * envelopes_document-url — a time-limited URL for VIEWING an envelope's document.
 *
 * AUTHENTICATED. Any member of the envelope's organization (CG-027), via the
 * same `resolveSender` gate as every other sender-side function.
 *
 * `"member"` and not `"send_documents"`: RLS already lets every org member
 * SELECT `signature_requests`, so the document list and this detail page render
 * for them. Gating the PDF behind a stronger rule than the row it belongs to is
 * precisely the mismatch CG-027 fixed — a member who had signed a document was
 * shown its audit trail, its hashes and its recipients, and then "Only admins
 * and owners can manage documents" where the document should have been.
 *
 * WHY THIS EXISTS ALONGSIDE `envelopes_download-signed`, WHICH LOOKS IDENTICAL.
 * The difference is the one thing this function does NOT do: it writes no audit
 * entry. `envelopes_download-signed` appends `integrity_verified` on every call,
 * because taking a copy of the finished document is an act worth recording.
 * Rendering the document in a pane on the overview page is not that act — it
 * happens on page load, on tab switch, and on every signed-URL refresh.
 *
 * Reusing the download function for the viewer would therefore have manufactured
 * download records for downloads nobody performed, in an append-only hash chain
 * that cannot be corrected afterwards. It would also have devalued the genuine
 * entries: a trail where "document downloaded" appears fifty times because
 * someone left the tab open says nothing at all. A viewer must be able to render
 * without asserting anything into the record.
 *
 * WHY NOT A BRANCH IN `files_r2_sign-read-url`. That function signs by resource
 * id against the `files` table, and an envelope's PDFs are not `files` rows —
 * `source_pdf_r2_key` is copied from a template version and `signed_pdf_r2_key`
 * is written server-side by `signing_submit`. Its own header states the rule that
 * server-written keys get their own function; that rule is why
 * `envelopes_download-signed` exists, and this follows it.
 *
 * WHICH PDF. `variant: 'signed'` (the default) prefers the finished document and
 * falls back to the source, so a viewer can ask for "the best available" without
 * first knowing the envelope's status. `variant: 'source'` forces the original —
 * the overlay of unfilled field boxes only makes sense over that one, because the
 * signed PDF already has every value burned into it. The resolved variant is
 * returned so the caller can label the pane and decide about the overlay rather
 * than guessing from `status`.
 *
 * `source_pdf_r2_key` is NOT NULL, so every envelope — draft included — has
 * something to show and this never 404s the way the download endpoint can.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import {
    loadEnvelopeForSender,
    resolveSender,
    serveSenderFunction,
    SenderAuthError,
} from "../_shared/senderAuth.ts";

// Shorter than the download URL's ten minutes would be pointless churn, and much
// longer starts to matter for a credential that ends up in browser history. The
// client's query caches under this.
const VIEW_URL_TTL_SECONDS = 60 * 30;

serveSenderFunction("envelopes_document-url", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "member");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    // CG-043. A third variant, and deliberately NOT a fallback: `'signed'` falls
    // back to the source so a caller can ask for "the best available" without
    // knowing the status, but there is no sensible substitute for a certificate.
    // Serving the contract to someone who asked for the certificate would hand
    // them a document that does not say what they wanted to know.
    if (body.variant === "certificate") {
        const { data, error } = await ctx.admin
            .from("signature_requests")
            .select("certificate_r2_key, certificate_sha256")
            .eq("id", envelope.id)
            .maybeSingle();

        if (error) {
            console.error("envelopes_document-url: certificate lookup failed:", error);
            throw new SenderAuthError(500, "Could not read the document");
        }
        if (!data?.certificate_r2_key) {
            throw new SenderAuthError(
                404,
                "No Certificate of Completion has been issued for this document yet."
            );
        }

        const certificateUrl = await getStorageDriver().createReadUrl({
            key: String(data.certificate_r2_key),
            expiresIn: VIEW_URL_TTL_SECONDS,
            claims: {
                userId: ctx.userId,
                orgId: ctx.organizationId,
                resourceId: envelope.id,
                resourceType: "envelope_document",
            },
        });

        return jsonResponse(
            {
                url: certificateUrl,
                variant: "certificate",
                expires_in: VIEW_URL_TTL_SECONDS,
                certificate_sha256: data.certificate_sha256,
            },
            200
        );
    }

    const wantsSource = body.variant === "source";
    const key = wantsSource
        ? envelope.source_pdf_r2_key
        : (envelope.signed_pdf_r2_key ?? envelope.source_pdf_r2_key);
    const variant = key === envelope.signed_pdf_r2_key ? "signed" : "source";

    const url = await getStorageDriver().createReadUrl({
        key,
        expiresIn: VIEW_URL_TTL_SECONDS,
        claims: {
            userId: ctx.userId,
            orgId: ctx.organizationId,
            resourceId: envelope.id,
            // The same resourceType `signing_session_open` and
            // `envelopes_download-signed` already mint, so the Worker needs no
            // change to serve this.
            resourceType: "envelope_document",
        },
    });

    return jsonResponse(
        {
            url,
            variant,
            expires_in: VIEW_URL_TTL_SECONDS,
            // Only the signed digest: `loadEnvelopeForSender` does not select the
            // source one, and the detail page already reads it from the envelope query.
            signed_pdf_sha256: envelope.signed_pdf_sha256,
        },
        200
    );
});
