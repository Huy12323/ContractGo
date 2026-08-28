// The arithmetic half of the client-side burn (CG-052) — box placement, image
// fitting and value-to-text resolution, with NO pdf-lib import.
//
// THE AUTHORITY FOR EVERY NUMBER IN THIS FILE IS
// `supabase/functions/_shared/pdfBurn.ts` (`burnPdfDocument`, the drawing loop).
// That module is the evidentiary path: it produces the PDF that gets PAdES-signed,
// hashed into the audit chain and cited on the certificate of completion. This
// file must place a mark exactly where that one would, because the trial's whole
// pitch is "this is what the real thing does".
//
// WHY THIS IS A REIMPLEMENTATION RATHER THAN AN IMPORT. `burnPdfDocument` is
// runtime-agnostic — no Deno APIs — so importing it from `src/` would in fact
// work. Three reasons it is duplicated instead:
//
//   1. `eslint.config.js` excludes `supabase/functions/**` by design (it is Deno
//      code with its own type-check). Shipping browser production code out of an
//      unlinted directory is a real regression in the lint contract.
//   2. House precedent is explicitly the other way. `Utils_Files_PublicUrl.ts`
//      says it for this exact situation: "Two runtimes, no shared module — so
//      the coupling is stated here rather than left to be discovered."
//   3. `burnPdfDocument` carries a decision the trial must NOT inherit:
//      `save({ useObjectStreams: false })` exists only because its output is
//      PAdES-signed downstream. The trial's output never is. Coupling them means
//      a future PAdES change ripples into a marketing page.
//
// The duplication is only acceptable BECAUSE it is pinned two ways: the
// colocated `.test.ts` transcribes the expected values, and
// `tests/unit/edge/pdfBurn.geometryParity.test.ts` imports the real
// `burnPdfDocument` and asserts the two agree. Drift is a CI failure, not a
// latent visual bug. Single-sourcing properly means refactoring the evidentiary
// burn path, which must not ride along on a marketing feature.

/** A field's box in page-relative 0–1 floats, origin TOP-LEFT. */
export type PdfBurn_Box = {
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
};

/** A box resolved to PDF user space, origin BOTTOM-LEFT. */
export type PdfBurn_Rect = {
    x: number;
    y: number;
    boxW: number;
    boxH: number;
};

/**
 * Layout space → PDF user space.
 *
 * The layout's origin is top-left (that is what the builder's overlay and the
 * browser's box model use); PDF user space is bottom-left. `y` is therefore the
 * distance from the page bottom to the box's BOTTOM edge, which is why
 * `h_pct` participates: `pageH - (y_pct + h_pct) * pageH`.
 */
export const utils_PdfBurn_Rect = (
    box: PdfBurn_Box,
    pageW: number,
    pageH: number
): PdfBurn_Rect => ({
    x: box.x_pct * pageW,
    y: pageH - (box.y_pct + box.h_pct) * pageH,
    boxW: box.w_pct * pageW,
    boxH: box.h_pct * pageH,
});

/**
 * Fits an image inside its box, preserving aspect ratio and centring the result.
 *
 * Aspect ratio is not a nicety here. Stretching a signature to fill a
 * differently-shaped box distorts it into something the signer did not write,
 * which is exactly the claim a signature is supposed to support.
 */
export const utils_PdfBurn_FitImage = (
    rect: PdfBurn_Rect,
    imageW: number,
    imageH: number
): { x: number; y: number; width: number; height: number } => {
    const scale = Math.min(rect.boxW / imageW, rect.boxH / imageH);
    const width = imageW * scale;
    const height = imageH * scale;
    return {
        x: rect.x + (rect.boxW - width) / 2,
        y: rect.y + (rect.boxH - height) / 2,
        width,
        height,
    };
};

/**
 * Text size and baseline for a value drawn in a box.
 *
 * `min(boxH * 0.8, 14)` leaves visual breathing room inside the box while
 * capping at a size that stays readable next to body text on a contract. The
 * `+ 2` / `- 4` inset on x and maxWidth keeps glyphs off the box border.
 */
export const const_PdfBurn_TextInset = 2;
export const const_PdfBurn_MaxFontSize = 14;

export const utils_PdfBurn_TextLayout = (
    rect: PdfBurn_Rect
): { x: number; y: number; size: number; maxWidth: number } => {
    const size = Math.min(rect.boxH * 0.8, const_PdfBurn_MaxFontSize);
    return {
        x: rect.x + const_PdfBurn_TextInset,
        y: rect.y + (rect.boxH - size) / 2,
        size,
        maxWidth: rect.boxW - const_PdfBurn_TextInset * 2,
    };
};

/**
 * A field's stored value → the string to draw, or `null` for "draw nothing".
 *
 * Every branch mirrors `burnPdfDocument`:
 *   * empty / null / undefined → nothing. An unfilled optional field leaves the
 *     page as it was rather than printing "undefined" onto a contract.
 *   * `checkbox` → "X" when ticked, nothing when not. An unticked box must not
 *     draw a mark that could later be read as one.
 *   * `choice` → the option's LABEL, falling back to the raw value when the
 *     option is gone. A layout can outlive an options list; showing the stored
 *     value beats showing nothing.
 *   * everything else → `String(value)`.
 */
export const utils_PdfBurn_TextForValue = (
    type: string,
    rawValue: unknown,
    options?: { label: string; value: string }[]
): string | null => {
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;

    if (type === "checkbox") {
        if (rawValue === false || rawValue === "false") return null;
        return "X";
    }

    if (type === "choice") {
        const match = options?.find((o) => o.value === String(rawValue));
        return match?.label ?? String(rawValue);
    }

    return String(rawValue);
};

/** Field types drawn as an embedded image rather than as text. */
export const utils_PdfBurn_IsImageField = (type: string): boolean =>
    type === "signature" || type === "initials";

/**
 * Attachments are separate documents in an envelope, not marks on this page, so
 * `burnPdfDocument` deliberately draws nothing for them. Kept as a named
 * predicate so the omission reads as a decision at the call site.
 */
export const utils_PdfBurn_IsUndrawnField = (type: string): boolean => type === "attachment";
