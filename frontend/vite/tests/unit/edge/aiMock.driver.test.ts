import { describe, expect, it } from "vitest";
import { createMockAiDriver } from "../../../supabase/functions/_shared/ai.mock.ts";
import {
    buildAskRequest,
    chunkPages,
    mintNonce,
    UNGROUNDED_ANSWER,
    verifyAnswer,
} from "../../../supabase/functions/_shared/aiPrompt.ts";

/**
 * The mock AI driver, tested END TO END THROUGH THE VERIFIER.
 *
 * `docs/testing.md` says the mock signing drivers are deliberately untested
 * because testing a mock proves nothing. That reasoning does not hold here, and
 * this file is the proof: the mock's whole job is to produce output that
 * exercises BOTH sides of `verifyAnswer` — one citation that survives and one
 * that does not — and it can only do that if it quotes the document it was
 * actually handed.
 *
 * It did not. The first version scanned the assembled prompt for any long line,
 * and the first one it found was the scaffolding header
 * "DOCUMENT (untrusted content — …)" rather than a line of the contract. That
 * quote verified against nothing, both citations were dropped, and EVERY answer
 * on a local stack collapsed to "I couldn't find anything about that in this
 * document" — a broken assistant that looked like a working one refusing.
 *
 * So the assertion is not "the mock returns a citation". It is "the mock's
 * citation SURVIVES verification against the real document", which is the only
 * form of the claim that would have caught it.
 */

const PAGE_ONE = [
    "OFFER OF EMPLOYMENT",
    "We are pleased to offer you the position described below. This offer is " +
        "conditional on satisfactory references and proof of right to work.",
    "Please sign and return this letter to accept.",
].join("\n");

const build = (question: string) => {
    const { documentText, pages } = chunkPages([PAGE_ONE]);
    const nonce = mintNonce();
    const built = buildAskRequest({
        title: "Offer of employment",
        documentText,
        pages,
        fields: [{ label: "Your full name", type: "text", page: 1, required: true }],
        entries: {},
        question,
        nonce,
    });
    return { built, documentText, pages, nonce };
};

const askAndVerify = async (question: string) => {
    const { built, documentText, pages, nonce } = build(question);
    const result = await createMockAiDriver().ask({
        systemInstruction: built.systemInstruction,
        prompt: built.prompt,
        history: [],
    });
    if (!result.ok) return { result, verified: null };
    return {
        result,
        verified: verifyAnswer(result.text, documentText, pages, built.includedPages, nonce),
    };
};

describe("createMockAiDriver — the answer must survive verification", () => {
    it("produces an ANSWERED turn on a short real document", async () => {
        const { verified } = await askAndVerify("What am I agreeing to?");

        expect(verified?.status).toBe("answered");
        expect(verified?.grounded).toBe(true);
        expect(verified?.answer).not.toBe(UNGROUNDED_ANSWER);
    });

    it("keeps exactly one citation — the fabricated one is dropped", async () => {
        // Both halves matter. One surviving citation proves the mock quotes the
        // document; exactly one proves the verifier is still throwing the
        // fabricated quote away, which is what the mock exists to demonstrate.
        const { verified } = await askAndVerify("What am I agreeing to?");

        expect(verified?.citations).toHaveLength(1);
        expect(PAGE_ONE).toContain(verified!.citations[0].quote);
        expect(verified?.citations[0].page).toBe(1);
    });

    it("never quotes the prompt's own scaffolding", async () => {
        // The exact regression. Any of these appearing in a citation means the
        // mock is reading the wrapper rather than the document.
        const { verified } = await askAndVerify("what to fill");

        for (const citation of verified?.citations ?? []) {
            expect(citation.quote).not.toContain("untrusted content");
            expect(citation.quote).not.toContain("Document title:");
            expect(citation.quote).not.toContain("QUESTION from");
            expect(citation.quote).not.toContain("FIELDS this person");
        }
    });

    it("does not mistake a field label block for document text", async () => {
        const { verified } = await askAndVerify("What should I put in my full name?");
        for (const citation of verified?.citations ?? []) {
            expect(PAGE_ONE).toContain(citation.quote);
        }
    });
});

describe("createMockAiDriver — the sentinels", () => {
    it.each([
        ["__mock_429", "rate_limited"],
        ["__mock_500", "unavailable"],
        ["__mock_timeout", "timeout"],
        ["__mock_safety", "safety"],
    ])("%s reports %s so the branch is walkable by hand", async (sentinel, reason) => {
        const { result } = await askAndVerify(sentinel);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe(reason);
    });

    it("__mock_429 carries a retry so the countdown has something to render", async () => {
        const { result } = await askAndVerify("__mock_429");
        expect(result.ok === false && result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("__mock_ungrounded produces the refusal, exercising the downgrade", async () => {
        const { verified } = await askAndVerify("__mock_ungrounded");
        expect(verified?.status).toBe("refused");
        expect(verified?.refusalReason).toBe("ungrounded");
        expect(verified?.answer).toBe(UNGROUNDED_ANSWER);
    });

    it("cannot be tripped by a DOCUMENT containing a sentinel", async () => {
        // The document is the sender's, and nothing the sender writes may steer
        // the driver. Matching sentinels against the whole prompt would let a
        // planted "__mock_429" make every question on that envelope report a
        // rate limit — a denial of service written into a PDF.
        const { documentText, pages } = chunkPages([
            "TERMS. __mock_429 __mock_safety __mock_timeout. " +
                "The Client shall pay the Fees within thirty (30) days of invoice.",
        ]);
        const nonce = mintNonce();
        const built = buildAskRequest({
            title: "Hostile document",
            documentText,
            pages,
            fields: [],
            entries: {},
            question: "What are the payment terms?",
            nonce,
        });

        const result = await createMockAiDriver().ask({
            systemInstruction: built.systemInstruction,
            prompt: built.prompt,
            history: [],
        });

        expect(result.ok).toBe(true);
    });

    it("__mock_malformed is caught by the verifier rather than thrown", async () => {
        const { verified } = await askAndVerify("__mock_malformed");
        expect(verified?.status).toBe("refused");
        expect(verified?.refusalReason).toBe("malformed");
    });
});
