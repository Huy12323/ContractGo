/**
 * envelopes_download-signed — a time-limited URL for the finished document.
 *
 * AUTHENTICATED. Any member of the envelope's organization (CG-027) — taking a
 * copy of a finished document is reading it, and a member can already read it.
 * The `integrity_verified` audit entry below is unchanged and now names members
 * too: who downloaded is exactly what that entry exists to record.
 *
 * Why a function rather than a `files_r2_sign-read-url` call: the signed PDF is
 * not a `files` row. It is written server-side by `signing_submit`'s finalize
 * step straight to an object key, deliberately never uploaded by a client, and
 * `files_r2_sign-read-url` signs by resource id against the `files` table. This
 * signs the key the request itself records.
 *
 * It also re-reports the stored `signed_pdf_sha256` alongside the URL. The
 * digest is the point of the whole exercise — a downloaded PDF that cannot be
 * checked against a recorded hash is just a PDF — and returning them together
 * means the person downloading has both without a second lookup.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getStorageDriver } from "../_shared/storage.ts";
import {
    loadEnvelopeForSender,
    logSenderEvent,
    resolveSender,
    SenderAuthError,
    serveSenderFunction,
} from "../_shared/senderAuth.ts";

const DOWNLOAD_URL_TTL_SECONDS = 60 * 10;

serveSenderFunction("envelopes_download-signed", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "member");
    const envelope = await loadEnvelopeForSender(ctx, String(body.envelope_id ?? ""));

    // The CHECK constraint `signature_requests_completed_has_pdf` guarantees a
    // completed row has both, so a missing key here means the document is not
    // finished rather than that something was lost.
    if (!envelope.signed_pdf_r2_key) {
        throw new SenderAuthError(
            409,
            "This document has not been signed by everyone yet, so there is nothing to download."
        );
    }

    const url = await getStorageDriver().createReadUrl({
        key: envelope.signed_pdf_r2_key,
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
        claims: {
            userId: ctx.userId,
            orgId: ctx.organizationId,
            resourceId: envelope.id,
            resourceType: "envelope_document",
        },
    });

    // Who took a copy of the finished document, and when, is part of the record.
    await logSenderEvent(ctx, {
        envelopeId: envelope.id,
        eventType: "integrity_verified",
        payload: {
            action: "download_signed",
            signed_pdf_sha256: envelope.signed_pdf_sha256,
        },
    });

    return jsonResponse(
        {
            url,
            expires_in: DOWNLOAD_URL_TTL_SECONDS,
            signed_pdf_sha256: envelope.signed_pdf_sha256,
        },
        200
    );
});
