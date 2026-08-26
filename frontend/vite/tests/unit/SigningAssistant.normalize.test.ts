import { describe, expect, it } from "vitest";
import { utils_SigningAssistant_NormalizeAnswer } from "@/components/signing/utils_SigningAssistant_NormalizeAnswer";

/**
 * The highest-value test in CG-049's frontend half.
 *
 * This function stands between a malformed response and a blank signing surface.
 * Every case below is a shape the panel could otherwise be handed, and the bar
 * for all of them is the same: renderable, or an explicit `null` the caller
 * turns into an error turn. Nothing throws.
 */

describe("utils_SigningAssistant_NormalizeAnswer — nothing usable", () => {
    it.each([
        ["null", null],
        ["undefined", undefined],
        ["a number", 42],
        ["a string", "an answer"],
        ["an empty object", {}],
        ["a non-string answer", { answer: 42 }],
        ["a whitespace-only answer", { answer: "   " }],
    ])("returns null for %s rather than throwing", (_label, input) => {
        expect(() => utils_SigningAssistant_NormalizeAnswer(input)).not.toThrow();
        expect(utils_SigningAssistant_NormalizeAnswer(input)).toBeNull();
    });
});

describe("utils_SigningAssistant_NormalizeAnswer — clamping", () => {
    it("caps bullets at 8 and drops non-strings", () => {
        const result = utils_SigningAssistant_NormalizeAnswer({
            answer: "ok",
            bullets: ["one", 7, null, "two", ...Array.from({ length: 20 }, (_, i) => `x${i}`)],
        });

        expect(result?.bullets).toHaveLength(8);
        expect(result?.bullets).toContain("one");
        expect(result?.bullets).not.toContain(7 as never);
    });

    it("clamps a runaway quote — a hallucinated wall of text must not blow the rail", () => {
        const result = utils_SigningAssistant_NormalizeAnswer({
            answer: "ok",
            citations: [{ page: 1, quote: "x".repeat(5000) }],
        });

        expect(result?.citations[0].quote.length).toBe(400);
    });

    it("caps citations at 4", () => {
        const result = utils_SigningAssistant_NormalizeAnswer({
            answer: "ok",
            citations: Array.from({ length: 12 }, (_, i) => ({ page: i + 1, quote: `quote ${i}` })),
        });

        expect(result?.citations).toHaveLength(4);
    });

    it("keeps the quote but zeroes an unusable page, so evidence is not lost to a bad button", () => {
        const result = utils_SigningAssistant_NormalizeAnswer({
            answer: "ok",
            citations: [
                { page: 0, quote: "a real clause" },
                { page: -3, quote: "another clause" },
                { page: 2.7, quote: "a third" },
            ],
        });

        expect(result?.citations.map((c) => c.quote)).toEqual([
            "a real clause",
            "another clause",
            "a third",
        ]);
        expect(result?.citations[0].page).toBe(0);
        expect(result?.citations[1].page).toBe(0);
        expect(result?.citations[2].page).toBe(2);
    });

    it("survives citations that are null or not objects", () => {
        const result = utils_SigningAssistant_NormalizeAnswer({
            answer: "ok",
            citations: [null, "text", 5, { page: 1, quote: "kept" }],
        });

        expect(result?.citations).toHaveLength(1);
    });

    it("treats a non-array citations field as none", () => {
        expect(
            utils_SigningAssistant_NormalizeAnswer({ answer: "ok", citations: null })?.citations
        ).toEqual([]);
    });
});

describe("utils_SigningAssistant_NormalizeAnswer — degrading safely", () => {
    it("degrades a non-boolean `grounded` to false, never to false confidence", () => {
        // The direction matters: `false` renders "check the document", which is
        // conservative. `true` would present an unverified answer as grounded.
        expect(
            utils_SigningAssistant_NormalizeAnswer({ answer: "ok", grounded: "yes" })?.grounded
        ).toBe(false);
        expect(utils_SigningAssistant_NormalizeAnswer({ answer: "ok" })?.grounded).toBe(false);
        expect(
            utils_SigningAssistant_NormalizeAnswer({ answer: "ok", grounded: true })?.grounded
        ).toBe(true);
    });

    it("reports turns_remaining only when it is really a number", () => {
        expect(
            utils_SigningAssistant_NormalizeAnswer({ answer: "ok", turns_remaining: 3 })
                ?.turnsRemaining
        ).toBe(3);
        expect(
            utils_SigningAssistant_NormalizeAnswer({ answer: "ok", turns_remaining: "3" })
                ?.turnsRemaining
        ).toBeNull();
    });

    it("passes the server's disclaimer through, and null when it is missing", () => {
        expect(
            utils_SigningAssistant_NormalizeAnswer({
                answer: "ok",
                disclaimer: "Not legal advice.",
            })?.disclaimer
        ).toBe("Not legal advice.");
        expect(utils_SigningAssistant_NormalizeAnswer({ answer: "ok" })?.disclaimer).toBeNull();
    });
});
