/**
 * signing_document_download — a copy of the document, for the party who signed it.
 *
 * PUBLIC (`verify_jwt = false`); `resolveSignerToken` is the mandatory first
 * line, exactly as in every other `signing_*` function. The credential is
 * normally the short-lived `view` token `signing_submit` hands back in its
 * response — the acting token is consumed by then and cannot authenticate
 * anything — or, for a party returning later through `signing_link_for_me`, the
 * live token their link already carries.
 *
 * WHY THIS EXISTS. A signer who closed the tab had no way back to what they
 * signed: the completion email is the only copy, and it does not arrive until
 * the LAST party signs. For a first-of-three signer that can be days. This is
 * the "would you like a copy?" every signing product offers at the moment the
 * signature lands, and the reason it could not be offered before is that there
 * was nothing to serve mid-flow — the burn runs once, at finalize.
 *
 * TWO DOCUMENTS, AND THEY ARE NOT THE SAME THING:
 *
 *   * FINAL — every party has signed, `signing_submit` burned and cryptographically
 *     signed the document, and `signed_pdf_r2_key` names it. That artifact IS the
 *     agreement, its digest is in the audit chain, and it is served byte-for-byte.
 *
 *   * INTERIM — others still have to sign. There is no agreement yet, so one is
 *     burned on demand from the pinned snapshot and whatever marks exist so far.
 *     It is NOT stored, NOT hashed into the chain, and NOT logged as
 *     `document_burned` — that event names the artifact every party agreed to, and
 *     minting one per download would put a stream of digests of half-finished
 *     documents into an evidence trail whose whole value is that each entry means
 *     one specific thing. The client labels this copy as not yet final.
 *
 * NOT LOGGED AT ALL, and that is a decision rather than an oversight. Taking a
 * copy of a document you are currently authorized to read is not a new
 * disclosure — the same reasoning `signing_session_open` records for
 * `signed_pdf_url` and `my_signature_url`. The sender-side
 * `envelopes_download-signed` DOES chain `integrity_verified`, because there the
 * question "which member took a copy" has an answer worth keeping; here the
 * answer is always "the signer named on the row", and the credential's own
 * `signer_token_issued` entry already records that it was minted.
 *
 * BYTES, NOT A URL. Every other document endpoint returns a signed R2 URL, and
 * this one deliberately does not: an interim copy has no R2 object to sign, and
 * returning a URL for one case and a body for the other would give the client two
 * download paths to get right. Serving the final PDF through the function costs
 * one extra hop for a file the burn pipeline already handles at this size.
 */

import { corsHeaders } from "../_shared/http.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import {
    resolveSignerToken,
    servePublicSigningFunction,
    SignerAuthError,
    type SignerContext,
} from "../_shared/signerAuth.ts";
import { burnPdfDocument, FONT_R2_KEY, type SnapshotField } from "../_shared/pdfBurn.ts";

type Snapshot = {
    layout?: SnapshotField[];
    pdf_file_path?: string | null;
};

servePublicSigningFunction("signing_document_download", async (body, req) => {
    const ctx = await resolveSignerToken(req, body);

    // ONLY A PARTY WHO HAS SIGNED. Before that there is nothing to take a copy
    // OF — the signer is looking at the live document in the filler, which is the
    // same bytes plus their unsaved entries. It also keeps this endpoint from
    // becoming a way to pull the document as a file without ever acting on it.
    //
    // A `cc` observer is refused for the same reason: they never sign, so this is
    // not their receipt. Their copy is the completion email.
    if (ctx.signer.status !== "signed") {
        throw new SignerAuthError(409, "A copy is available once you have signed this document.");
    }

    const storage = getStorageDriver();

    const bytes = ctx.request.signed_pdf_r2_key
        ? await storage.getObject(ctx.request.signed_pdf_r2_key)
        : await burnInterimCopy(ctx);

    return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/pdf",
            // NEVER CACHED. A short-lived credential is what authorized this, and
            // an interim copy is stale the moment the next party signs.
            "Cache-Control": "no-store",
        },
    });
});

/**
 * The document as it stands, burned on demand.
 *
 * Deliberately the same merge and the same keying `signing_submit`'s
 * `finalizeRequest` performs, because a copy that composed the document
 * differently from the way it will finally be composed would be worse than no
 * copy at all — the signer would be holding a document that disagrees with the
 * one they eventually receive.
 */
async function burnInterimCopy(ctx: SignerContext): Promise<Uint8Array> {
    const storage = getStorageDriver();
    const snapshot = (ctx.request.template_snapshot ?? {}) as Snapshot;
    const layout = Array.isArray(snapshot.layout) ? snapshot.layout : [];

    const { data: allSigners, error: signersError } = await ctx.admin
        .from("signature_request_signers")
        .select("id, role_id, field_values")
        .eq("request_id", ctx.request.id);

    if (signersError || !allSigners) {
        console.error("Interim copy: could not load signers:", signersError);
        throw new SignerAuthError(500, "Could not build a copy of this document.");
    }

    // LIVE captures only — the same `superseded_at IS NULL` filter finalize uses,
    // and load-bearing for the same reason: CG-014 keeps a replaced capture as
    // evidence, so a signer who went through the review loop has two rows here and
    // the copy must carry the mark that is actually on the document.
    const { data: captures, error: capturesError } = await ctx.admin
        .from("signature_captures")
        .select("signer_id, signature_r2_key")
        .eq("request_id", ctx.request.id)
        .is("superseded_at", null);

    if (capturesError) {
        console.error("Interim copy: could not load captures:", capturesError);
        throw new SignerAuthError(500, "Could not build a copy of this document.");
    }

    // The sender's compose-time entries first, then every signer's own values on
    // top — a union in practice, since each party may only write field ids
    // belonging to their own role.
    const mergedValues = allSigners.reduce<Record<string, unknown>>(
        (acc, signer) => ({ ...acc, ...((signer.field_values ?? {}) as object) }),
        { ...((ctx.request.prefilled_values ?? {}) as Record<string, unknown>) }
    );

    const roleBySignerId = new Map(allSigners.map((s) => [s.id, s.role_id]));
    const signatureImages: Record<string, Uint8Array> = {};
    for (const capture of captures ?? []) {
        const roleId = roleBySignerId.get(capture.signer_id);
        if (!roleId) continue;
        const imageBytes = await storage.getObject(capture.signature_r2_key);
        for (const field of layout) {
            if (
                field.role_id === roleId &&
                (field.type === "signature" || field.type === "initials")
            ) {
                signatureImages[field.id] = imageBytes;
            }
        }
    }

    const sourceKey = snapshot.pdf_file_path || ctx.request.source_pdf_r2_key;
    const [sourcePdfBytes, fontBytes] = await Promise.all([
        storage.getObject(sourceKey),
        storage.getObject(FONT_R2_KEY),
    ]);

    return await burnPdfDocument({
        sourcePdfBytes,
        fontBytes,
        layout,
        fieldValues: mergedValues,
        signatureImages,
    });
}
