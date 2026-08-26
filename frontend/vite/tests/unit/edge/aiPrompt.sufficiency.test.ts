import { describe, expect, it } from "vitest";
import {
    assessSufficiency,
    MAX_DOCUMENT_CHARS,
} from "../../../supabase/functions/_shared/aiPrompt.ts";

/**
 * "Can this document be answered from at all?"
 *
 * The heuristic that decides whether a signer gets an assistant or an honest
 * "I can't read this — it looks like a scan". Getting it wrong in the permissive
 * direction is the expensive one: an ungrounded model guessing at a contract it
 * cannot read is the worst outcome this feature has available.
 */

const text = (chars: number) => "x".repeat(chars);

describe("assessSufficiency", () => {
    it("accepts an ordinary contract", () => {
        expect(assessSufficiency(text(20_000), 8)).toBe("ready");
    });

    it("rejects a document with almost no text at all", () => {
        expect(assessSufficiency(text(199), 1)).toBe("insufficient_text");
        expect(assessSufficiency("", 4)).toBe("insufficient_text");
    });

    it("rejects a long scan whose few text pages clear the total bound", () => {
        // 40 pages, 600 characters — one OCR watermark repeated. Passes the
        // total test and fails the per-page average, which is why both exist.
        expect(assessSufficiency(text(600), 40)).toBe("insufficient_text");
    });

    it("rejects a one-page scan whose single line clears the average", () => {
        // 1 page, 150 characters: clears 20-per-page comfortably and still is
        // not a document. This is the case the total bound catches.
        expect(assessSufficiency(text(150), 1)).toBe("insufficient_text");
    });

    it("refuses rather than truncating past the hard ceiling", () => {
        // Truncating would leave the model unable to tell "the document does not
        // say" from "the part I was given does not say" — and it reports the
        // first, confidently.
        expect(assessSufficiency(text(MAX_DOCUMENT_CHARS + 1), 500)).toBe("too_large");
    });

    it("tolerates a zero page count rather than dividing by it", () => {
        expect(() => assessSufficiency(text(5_000), 0)).not.toThrow();
        expect(assessSufficiency(text(5_000), 0)).toBe("ready");
    });
});
