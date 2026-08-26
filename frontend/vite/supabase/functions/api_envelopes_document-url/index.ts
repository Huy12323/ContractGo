/**
 * api_envelopes_document-url — a time-limited link to one of a document's PDFs.
 *
 * A URL, NOT PROXIED BYTES. Streaming a multi-megabyte PDF through an edge
 * function costs an invocation's wall clock and memory for no benefit: the
 * storage driver already mints signed, expiring URLs, and the caller's HTTP
 * client can follow one. It also keeps this endpoint's latency independent of
 * document size, which matters when an integrator is polling.
 *
 * `member` scope, mirroring `envelopes_document-url` — this shows a caller a
 * document its organization can already list.
 *
 * WRITES NO AUDIT ENTRY, deliberately, and this is the reason the sender-side
 * function exists separately from `envelopes_download-signed`: that one appends
 * `integrity_verified` on every call, which is correct for a human deliberately
 * taking a copy of the contract and would be pure noise from a poller. An
 * evidence trail that fills up with "a program looked at this" stops being
 * readable as the story of the agreement.
 */

import { jsonResponse } from "../_shared/http.ts";
import { ApiAuthError, resolveApiClient, serveApiFunction } from "../_shared/apiAuth.ts";
import { loadEnvelopeForSender } from "../_shared/senderAuth.ts";
import { getStorageDriver } from "../_shared/storage.ts";

/** Matches `envelopes_document-url`. Long enough to fetch, short enough that a
 *  leaked link is not a lasting credential. */
const URL_TTL_SECONDS = 60 * 30;

type Variant = "signed" | "source" | "certificate";

serveApiFunction("api_envelopes_document-url", async (body, req) => {
    const ctx = await resolveApiClient(req, String(body.organization_id ?? ""), "member");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    const requested = (body.variant ?? "signed") as Variant;
    if (requested !== "signed" && requested !== "source" && requested !== "certificate") {
        throw new ApiAuthError(
            400,
            "invalid_request",
            "variant must be one of: signed, source, certificate"
        );
    }

    // One select for the three digests and the certificate key.
    // `loadEnvelopeForSender` deliberately carries a narrow column set, and the
    // alternative — returning `sha256: null` for the source variant — would be
    // indistinguishable from "this artifact has no digest", which is never true.
    // Every response from this endpoint names the digest of the exact bytes the
    // URL will serve; that is the property an integrator verifies against.
    const { data: digests, error: digestsError } = await ctx.admin
        .from("signature_requests")
        .select("source_pdf_sha256, certificate_r2_key, certificate_sha256")
        .eq("id", envelope.id)
        .maybeSingle();

    if (digestsError || !digests) {
        console.error("api_envelopes_document-url: digest lookup failed:", digestsError);
        throw new ApiAuthError(500, "internal_error", "Could not read the document");
    }

    // The certificate is NOT part of the signed→source fallback below, and that
    // is deliberate rather than an omission: there is no sensible substitute for
    // a Certificate of Completion. Serving the contract to a caller that asked
    // for the certificate would hand it a document that does not say what it
    // wanted to know, and it would have no way to tell.
    if (requested === "certificate") {
        const data = digests;
        if (!data?.certificate_r2_key) {
            throw new ApiAuthError(
                404,
                "certificate_not_issued",
                "No Certificate of Completion has been issued for this document yet"
            );
        }

        return jsonResponse(
            {
                url: await getStorageDriver().createReadUrl({
                    key: String(data.certificate_r2_key),
                    expiresIn: URL_TTL_SECONDS,
                    claims: {
                        userId: ctx.userId,
                        orgId: ctx.organizationId,
                        resourceId: envelope.id,
                        resourceType: "envelope_document",
                    },
                }),
                variant: "certificate",
                expires_in: URL_TTL_SECONDS,
                sha256: data.certificate_sha256,
            },
            200
        );
    }

    // `signed` means "the best available": it falls back to the source so a
    // caller can ask without first checking the status. The variant it actually
    // resolved is returned, so the caller never has to infer which one it got.
    // `source_pdf_r2_key` is NOT NULL, so this never 404s.
    const key =
        requested === "source"
            ? envelope.source_pdf_r2_key
            : (envelope.signed_pdf_r2_key ?? envelope.source_pdf_r2_key);
    const resolvedVariant = key === envelope.signed_pdf_r2_key ? "signed" : "source";

    return jsonResponse(
        {
            url: await getStorageDriver().createReadUrl({
                key,
                expiresIn: URL_TTL_SECONDS,
                claims: {
                    userId: ctx.userId,
                    orgId: ctx.organizationId,
                    resourceId: envelope.id,
                    resourceType: "envelope_document",
                },
            }),
            variant: resolvedVariant,
            expires_in: URL_TTL_SECONDS,
            // The digest of the bytes this URL serves, always — never the other
            // variant's. Handing back `signed_pdf_sha256` beside a URL that
            // resolved to the source would make an integrator's integrity check
            // fail on a document that is perfectly intact.
            sha256:
                resolvedVariant === "signed"
                    ? envelope.signed_pdf_sha256
                    : digests.source_pdf_sha256,
        },
        200
    );
});
