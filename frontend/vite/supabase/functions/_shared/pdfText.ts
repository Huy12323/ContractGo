/**
 * PDF text extraction for the signer assistant (CG-049).
 *
 * `unpdf` AND NOT `pdfjs-dist`. unpdf is a serverless rebuild of pdf.js with no
 * DOM, no worker file, no canvas and no `DOMMatrix` shim — all four of which a
 * Deno edge function would otherwise have to fake. The app already ships
 * `pdfjs-dist` for RENDERING in the browser, where those things exist.
 *
 * AND NOT `pdf-lib`, which this repo already depends on and which cannot do
 * this: `pdf-lib` is a writer. It parses the object graph well enough to stamp a
 * signature widget onto a page (`pdfBurn.ts`) and has no text-layer extraction
 * at all. Reaching for the dependency that is already there would have been the
 * obvious move and would not have worked.
 *
 * IMPURE — it imports a vendor module — so nothing here may be unit tested per
 * `docs/testing.md`. The two pieces of real logic, `chunkPages` and the
 * sufficiency heuristic, are therefore either in `aiPrompt.ts` or exported here
 * as pure functions with no `unpdf` in their path.
 */

import { extractText, getDocumentProxy } from "unpdf";
import { assessSufficiency, chunkPages, sanitizeDocumentText } from "./aiPrompt.ts";
import type { AiPage, ExtractionStatus } from "./aiPrompt.ts";

export type ExtractedDocument = {
    status: ExtractionStatus;
    documentText: string;
    pages: AiPage[];
    charCount: number;
    pageCount: number;
    error?: string;
};

export async function extractDocumentText(bytes: Uint8Array): Promise<ExtractedDocument> {
    try {
        const pdf = await getDocumentProxy(bytes);
        // `mergePages: false` gives one string PER PAGE, and that array IS the
        // citation anchor — a merged string would leave page numbers to be
        // guessed, which is the one thing a citation may not do.
        const { text } = await extractText(pdf, { mergePages: false });
        const pageTexts = (text as string[]).map((page) => sanitizeDocumentText(page ?? ""));

        const { documentText, pages } = chunkPages(pageTexts);
        const status = assessSufficiency(documentText, pageTexts.length);

        return {
            status,
            documentText: status === "ready" ? documentText : "",
            pages: status === "ready" ? pages : [],
            charCount: documentText.length,
            pageCount: pageTexts.length,
        };
    } catch (err) {
        // A malformed or encrypted PDF is a normal outcome on a surface that
        // accepts whatever the sender uploaded, not an exception the endpoint
        // should propagate. The signer gets an honest refusal and their turn
        // back; the operator gets the reason in the row.
        return {
            status: "failed",
            documentText: "",
            pages: [],
            charCount: 0,
            pageCount: 0,
            error: String(err).slice(0, 500),
        };
    }
}
