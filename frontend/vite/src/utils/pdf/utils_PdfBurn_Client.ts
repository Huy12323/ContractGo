// The client-side burn (CG-052) — flattens field values and a signature onto a
// PDF entirely in the browser.
//
// THE FILE NEVER LEAVES THE BROWSER. That is not an implementation detail, it is
// the trial's whole proposition, and it is the same stance `Page_Verify` already
// takes ("the page says so twice ... because that is the difference between a
// tool people use on a confidential contract and one they close"). Nothing in
// this module or anything it imports may acquire a network call to our own
// origin. The one `fetch` here goes to a static asset on the same origin and is
// covered below.
//
// THIS IS THE ONLY FILE IN `src/` THAT NAMES pdf-lib, and only inside a function
// body. The dynamic `import()` is what keeps pdf-lib + fontkit (~400KB) out of
// the entry chunk, so a visitor reading the landing page never downloads a PDF
// writer. Callers may static-import this wrapper freely — Rollup follows the
// dynamic import and emits the async chunk automatically, which is why
// `vite.config.ts` needs no `manualChunks`. Verify with the `pnpm build` chunk
// report rather than by reasoning about it.
//
// Every coordinate decision lives in `utils_PdfBurn_Geometry.ts`, which carries
// the note on why this is a reimplementation of `_shared/pdfBurn.ts` rather than
// an import of it, and how the two are pinned together.

import {
    utils_PdfBurn_FitImage,
    utils_PdfBurn_IsImageField,
    utils_PdfBurn_IsUndrawnField,
    utils_PdfBurn_Rect,
    utils_PdfBurn_TextForValue,
    utils_PdfBurn_TextLayout,
} from "./utils_PdfBurn_Geometry";
import { utils_PdfBurn_SanitizePng } from "./utils_PdfBurn_SanitizePng";

/** A field positioned on a page, in the same 0–1 top-left space the builder uses. */
export type PdfBurn_Field = {
    id: string;
    type: string;
    page: number;
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
    options?: { label: string; value: string }[];
};

/**
 * Unicode font served from our own origin.
 *
 * PDF standard fonts are Latin-1 only, and this repo carries Noto Serif because
 * of a Vietnamese-font hotfix — accented names in contracts are real, and
 * Helvetica throws `WinAnsi cannot encode` on them rather than degrading. The
 * OFL licence ships beside it, as the licence requires.
 *
 * Fetched at BURN TIME only, so nobody pays 712KB while browsing, and cached for
 * a year by the `/fonts/*` rule in `public/_headers`.
 */
export const const_PdfBurn_FontUrl = "/fonts/NotoSerif-Regular.ttf";

export type PdfBurn_Result = {
    bytes: Uint8Array;
    /**
     * True when the Unicode font could not be fetched and Helvetica was used.
     * The caller may warn; it must NOT block the download. A trial that produces
     * no file because a font 404'd is the worst possible outcome.
     */
    usedFallbackFont: boolean;
};

/** Fetches the Unicode font, or `null` if it is unavailable for any reason. */
const utils_PdfBurn_LoadFont = async (): Promise<Uint8Array | null> => {
    try {
        const response = await fetch(const_PdfBurn_FontUrl);
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
    } catch {
        // Offline, blocked, or the asset is missing from the deploy. All three
        // mean the same thing to the caller: burn with Helvetica.
        return null;
    }
};

/**
 * Burns values and signature images onto `sourcePdfBytes` and returns new bytes.
 *
 * Mirrors `_shared/pdfBurn.ts`'s `burnPdfDocument` field-for-field, with two
 * deliberate differences:
 *
 *   * No `useObjectStreams: false`. That flag exists in the edge function only
 *     because its output is PAdES-signed downstream and an incremental update
 *     needs a classic xref table. The trial's output is never signed, so it
 *     takes pdf-lib's default and the smaller file.
 *   * The font can fall back to Helvetica, because a browser fetch can fail in
 *     ways a server-side R2 read does not.
 */
export const utils_PdfBurn_Client = async ({
    sourcePdfBytes,
    layout,
    fieldValues,
    signatureImages,
}: {
    sourcePdfBytes: Uint8Array;
    layout: PdfBurn_Field[];
    fieldValues: Record<string, unknown>;
    /** PNG bytes keyed by the field id they belong in. */
    signatureImages: Record<string, Uint8Array>;
}): Promise<PdfBurn_Result> => {
    // Both loaded in parallel with the font so the visitor waits once, not twice.
    const [{ PDFDocument, StandardFonts, rgb }, { default: fontkit }, fontBytes] =
        await Promise.all([
            import("pdf-lib"),
            import("@pdf-lib/fontkit"),
            utils_PdfBurn_LoadFont(),
        ]);

    // Never `ignoreEncryption: true`. On a password-protected PDF it "works" and
    // then produces garbage; letting this throw is what lets the caller show the
    // visitor a real reason and keep their work.
    const pdfDoc = await PDFDocument.load(sourcePdfBytes);

    let font;
    if (fontBytes) {
        pdfDoc.registerFontkit(fontkit);
        font = await pdfDoc.embedFont(fontBytes, { subset: false });
    } else {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    // Embed each image once even when it appears in several boxes.
    const embedded = new Map<string, Awaited<ReturnType<typeof pdfDoc.embedPng>>>();
    for (const [fieldId, bytes] of Object.entries(signatureImages)) {
        embedded.set(fieldId, await pdfDoc.embedPng(utils_PdfBurn_SanitizePng(bytes)));
    }

    const pageCount = pdfDoc.getPageCount();

    for (const field of layout) {
        // A field pointing past the end of its own PDF is a bug somewhere
        // upstream, but dropping it beats failing the whole burn — the visitor
        // still gets the document with everything else on it.
        if (field.page < 1 || field.page > pageCount) continue;
        if (utils_PdfBurn_IsUndrawnField(field.type)) continue;

        const page = pdfDoc.getPage(field.page - 1);
        const { width: pageW, height: pageH } = page.getSize();
        const rect = utils_PdfBurn_Rect(field, pageW, pageH);

        if (utils_PdfBurn_IsImageField(field.type)) {
            const image = embedded.get(field.id);
            // No entry means the field was left blank. Reusing another field's
            // image to fill it would forge a mark the signer never made.
            if (!image) continue;
            page.drawImage(image, utils_PdfBurn_FitImage(rect, image.width, image.height));
            continue;
        }

        const text = utils_PdfBurn_TextForValue(field.type, fieldValues[field.id], field.options);
        if (text === null) continue;

        const textLayout = utils_PdfBurn_TextLayout(rect);
        page.drawText(text, {
            x: textLayout.x,
            y: textLayout.y,
            size: textLayout.size,
            font,
            color: rgb(0, 0, 0),
            maxWidth: textLayout.maxWidth,
        });
    }

    return { bytes: await pdfDoc.save(), usedFallbackFont: fontBytes === null };
};
