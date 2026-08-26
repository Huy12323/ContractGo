/**
 * Scrolls the rendered PDF to a page number — CG-049.
 *
 * A DOM QUERY AND NOT A REF, deliberately. `App_PdfDocument` already stamps
 * `data-pdf-page` on every page wrapper, and `App_DocumentFiller.scrollToField`
 * already navigates the same pane by exactly this idiom. Doing it with a ref
 * instead would mean a `useImperativeHandle` on the PDF component and three prop
 * drills through the filler — for one `scrollIntoView`.
 *
 * RETURNS A BOOLEAN AND NEVER THROWS. The page may not be mounted: the assistant
 * is reachable from the welcome and sign steps, where no PDF is on screen, and
 * from a virtualised list where a distant page has not rendered yet. A scroll
 * that did not happen is a small disappointment; an exception on the signing
 * surface is not, so the caller retries once and then lets it go.
 */
export const utils_Pdf_ScrollToPage = (page: number): boolean => {
    if (!Number.isFinite(page) || page < 1) return false;
    if (typeof document === "undefined") return false;

    const element = document.querySelector(`[data-pdf-page="${page}"]`);
    if (!element) return false;

    const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    return true;
};
