/**
 * PDF burn — overlays field values and a signature image onto a source PDF.
 *
 * Harvested verbatim from `employee-onboarding_approve-contract/index.ts`, where
 * it existed byte-identically alongside a second copy in
 * `employee-onboarding_approve-content/index.ts`. Both copies are replaced by
 * this module; behaviour is unchanged.
 *
 * This is the *appearance* layer only — it draws pixels. It performs no
 * cryptography and produces no `/Sig` dictionary. Digital signing consumes the
 * flattened output of `burnPdfContract` and lives behind the signing driver
 * seam (see `_shared/signing.ts`), so the two concerns stay independently
 * testable and a signing provider never needs to know about layout.
 *
 * Consumers must map `pdf-lib` and `@pdf-lib/fontkit` in their own `deno.json`:
 *
 *     "pdf-lib": "npm:pdf-lib@1.17.1",
 *     "@pdf-lib/fontkit": "npm:@pdf-lib/fontkit@1.1.1"
 */

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * One positioned field on a page. Coordinates are 0–1 floats relative to the
 * page box, so the same layout renders identically in the builder, the filler
 * and here regardless of zoom or page size.
 */
export type PositionedField = {
    key: string;
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
    type: string;
};

/** Unicode-capable font shipped in the bucket; PDF standard fonts are Latin-1 only. */
export const FONT_R2_KEY = "_system/fonts/NotoSerif-Regular.ttf";

/**
 * pdf-lib 1.17.1 reads PNG chunk CRCs via `getInt32`; CRCs >= 2^31 come back
 * negative and blow up the subsequent `setUint32`. Zero those out before embed.
 */
export function sanitizePngForPdfLib(png: Uint8Array): Uint8Array {
    const buf = new Uint8Array(png);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 8;
    while (offset + 12 <= buf.length) {
        const len = view.getUint32(offset);
        const crcPos = offset + 8 + len;
        if (crcPos + 4 > buf.length) break;
        if (view.getUint32(crcPos) > 0x7fffffff) {
            view.setUint32(crcPos, 0);
        }
        offset = crcPos + 4;
    }
    return buf;
}

export async function burnPdfContract({
    sourcePdfBytes,
    signatureBytes,
    fontBytes,
    layout,
    fieldValues,
    choiceLabels,
}: {
    sourcePdfBytes: Uint8Array;
    signatureBytes: Uint8Array | null;
    fontBytes: Uint8Array;
    layout: PositionedField[];
    fieldValues: Record<string, unknown>;
    choiceLabels: Record<string, Record<string, string>>;
}): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(sourcePdfBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    const signatureImage = signatureBytes
        ? await pdfDoc.embedPng(sanitizePngForPdfLib(signatureBytes))
        : null;

    for (const field of layout) {
        const page = pdfDoc.getPage(field.page - 1);
        const { width: pageW, height: pageH } = page.getSize();

        // Layout origin is top-left; PDF user space is bottom-left.
        const x = field.x_pct * pageW;
        const y = pageH - (field.y_pct + field.h_pct) * pageH;
        const boxW = field.w_pct * pageW;
        const boxH = field.h_pct * pageH;

        if (field.type === "signature") {
            if (signatureImage) {
                page.drawImage(signatureImage, { x, y, width: boxW, height: boxH });
            }
            continue;
        }

        const rawValue = fieldValues[field.key];
        if (rawValue === undefined || rawValue === null || rawValue === "") continue;

        let text = String(rawValue);
        if (field.type === "choice" && choiceLabels[field.key]) {
            text = choiceLabels[field.key][text] ?? text;
        }

        const fontSize = Math.min(boxH * 0.8, 14);
        const textY = y + (boxH - fontSize) / 2;

        page.drawText(text, {
            x: x + 2,
            y: textY,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            maxWidth: boxW - 4,
        });
    }

    return pdfDoc.save();
}

// ============================================================
// v2 — self-describing layout, N signatures
// ============================================================
//
// `burnPdfContract` above is the v1 path and stays byte-compatible for the
// onboarding functions that still call it (they retire in Phase J). It cannot
// serve ContractGo because of two assumptions baked into its signature:
//
//   * fields are addressed by `key`, and labels/options are resolved elsewhere.
//     v2 fields are self-describing and identified by `id` — keys can repeat
//     across roles ("full_name" for each party), so keying values by `key`
//     collides the moment a template has more than one signer.
//   * there is exactly ONE signature image for the whole document. A multi-
//     signer envelope has one per signer, each belonging to specific boxes.
//
// Everything else — coordinate convention, font handling, the PNG CRC
// sanitizer — is shared.

/** One field from `Template_Snapshot.layout` (`TemplateField` in the frontend). */
export type SnapshotField = {
    id: string;
    key: string;
    label: string;
    type: string;
    role_id: string;
    required: boolean;
    options?: { label: string; value: string }[];
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
};

export async function burnPdfDocument({
    sourcePdfBytes,
    fontBytes,
    layout,
    /** Keyed by field id, merged across every signer on the request. */
    fieldValues,
    /**
     * Signature/initials images keyed by the field id they belong in. A field
     * with no entry is left blank rather than filled with someone else's mark —
     * silently reusing an image would forge a signature.
     */
    signatureImages,
}: {
    sourcePdfBytes: Uint8Array;
    fontBytes: Uint8Array;
    layout: SnapshotField[];
    fieldValues: Record<string, unknown>;
    signatureImages: Record<string, Uint8Array>;
}): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(sourcePdfBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });

    // Embed each distinct image once even when a signer has several boxes.
    const embedded = new Map<string, Awaited<ReturnType<typeof pdfDoc.embedPng>>>();
    for (const [fieldId, bytes] of Object.entries(signatureImages)) {
        embedded.set(fieldId, await pdfDoc.embedPng(sanitizePngForPdfLib(bytes)));
    }

    const pageCount = pdfDoc.getPageCount();

    for (const field of layout) {
        // A snapshot that points past the end of its own PDF is corrupt, but
        // dropping the field is better than failing the whole signature — the
        // remaining evidence (hashes, audit chain) still stands.
        if (field.page < 1 || field.page > pageCount) {
            console.warn(
                `burnPdfDocument: field ${field.id} targets page ${field.page} of ${pageCount}; skipped`
            );
            continue;
        }

        const page = pdfDoc.getPage(field.page - 1);
        const { width: pageW, height: pageH } = page.getSize();

        // Layout origin is top-left; PDF user space is bottom-left.
        const x = field.x_pct * pageW;
        const y = pageH - (field.y_pct + field.h_pct) * pageH;
        const boxW = field.w_pct * pageW;
        const boxH = field.h_pct * pageH;

        if (field.type === "signature" || field.type === "initials") {
            const image = embedded.get(field.id);
            if (image) {
                // Preserve aspect ratio inside the box — stretching a signature
                // to fill a differently-shaped box distorts it into something
                // the signer did not write.
                const scale = Math.min(boxW / image.width, boxH / image.height);
                const drawW = image.width * scale;
                const drawH = image.height * scale;
                page.drawImage(image, {
                    x: x + (boxW - drawW) / 2,
                    y: y + (boxH - drawH) / 2,
                    width: drawW,
                    height: drawH,
                });
            }
            continue;
        }

        // Attachments are separate documents in the envelope, not marks on this
        // page — there is nothing to draw.
        if (field.type === "attachment") continue;

        const rawValue = fieldValues[field.id];
        if (rawValue === undefined || rawValue === null || rawValue === "") continue;

        let text: string;
        if (field.type === "checkbox") {
            if (rawValue === false || rawValue === "false") continue;
            text = "X";
        } else if (field.type === "choice") {
            const match = field.options?.find((o) => o.value === String(rawValue));
            text = match?.label ?? String(rawValue);
        } else {
            text = String(rawValue);
        }

        const fontSize = Math.min(boxH * 0.8, 14);
        const textY = y + (boxH - fontSize) / 2;

        page.drawText(text, {
            x: x + 2,
            y: textY,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            maxWidth: boxW - 4,
        });
    }

    // `useObjectStreams: false` is REQUIRED, not a preference. This output is
    // what `_shared/signing.ts` signs, and a PAdES signature is an incremental
    // update appended after the existing content — which needs a classic
    // cross-reference TABLE, not the compressed xref STREAM pdf-lib writes by
    // default. With object streams on the placeholder still inserts and the
    // ByteRange still computes, but readers reject the result. See `pades.ts`.
    return pdfDoc.save({ useObjectStreams: false });
}
