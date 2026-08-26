/**
 * The mock AI driver (CG-049).
 *
 * DETERMINISTIC, AND IT EARNS ITS KEEP RATHER THAN JUST EXISTING. `docs/testing.md`
 * says the mock signing drivers are deliberately untested because testing a mock
 * proves nothing. That is true of a mock that only succeeds. This one is
 * different in two ways that matter:
 *
 *  1. Its canned answer carries TWO citations — one that is a real substring of
 *     the document it was handed, and one that is not. So a developer walking
 *     the local stack sees the verifier actually drop a fabricated quote, which
 *     is the single most important behaviour in the feature and is otherwise
 *     only observable by getting a real model to lie.
 *
 *  2. Sentinel questions make EVERY failure branch reachable by hand, with no
 *     API key and no way to induce a real outage: `__mock_429`, `__mock_500`,
 *     `__mock_timeout`, `__mock_safety`, `__mock_malformed`, `__mock_ungrounded`.
 *     Those are the branches a real incident takes — the refund path, the
 *     countdown, the error bubble — and they would otherwise ship untested and
 *     first execute in production during the outage they exist for.
 *
 * The sentinels are matched against the SIGNER'S QUESTION alone — never the
 * assembled prompt — so a document that happens to contain "__mock_429" cannot
 * steer the driver. See `askedQuestion`.
 */

import type { AiAskArgs, AiAskResult, AiDriver } from "./ai.ts";

/**
 * The signer's actual question, not the whole assembled prompt.
 *
 * The sentinels are matched against THIS and not against `args.prompt`, for the
 * same reason `firstRealSentence` reads only inside the fence: a document
 * containing the text "__mock_429" would otherwise make every question on that
 * envelope report a rate limit. The document is the sender's, and nothing the
 * sender writes may steer the driver.
 */
function askedQuestion(prompt: string): string {
    const marker = "QUESTION from the person about to sign:";
    const at = prompt.lastIndexOf(marker);
    return at === -1 ? "" : prompt.slice(at + marker.length).trim();
}

/**
 * Pulls a real sentence out of the DOCUMENT BLOCK — and only out of it.
 *
 * ⚠ SCOPED TO THE FENCE ON PURPOSE. The obvious version of this scanned the
 * whole prompt for the first long line, and the first long line in an assembled
 * prompt is the scaffolding header "DOCUMENT (untrusted content — …)", not a
 * line of the contract. That quote verified against nothing, both citations were
 * dropped, and every answer on a local stack collapsed to "I couldn't find
 * anything about that in this document" — an assistant that looked like it was
 * working and refusing, when it was simply broken.
 *
 * So the extraction is anchored: everything between the opening and closing DOC
 * markers, minus the `[page N]` tags, is document text and nothing else is.
 * `aiMock.driver.test.ts` asserts the result SURVIVES `verifyAnswer`, which is
 * the only form of the claim that catches this class of mistake.
 */
function firstRealSentence(prompt: string): string | null {
    const open = prompt.indexOf("⟦DOC:");
    const close = prompt.indexOf("⟦/DOC:");
    if (open === -1 || close === -1 || close <= open) return null;

    // Past the end of the opening marker's own line.
    const bodyStart = prompt.indexOf("\n", open);
    if (bodyStart === -1 || bodyStart >= close) return null;

    const lines = prompt
        .slice(bodyStart + 1, close)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^\[page \d+\]$/.test(line));

    // Long enough to be evidence: `verifyAnswer` rejects quotes under 12
    // characters because a one-word quote matches almost any page and proves
    // nothing. A 40-character floor keeps the mock well clear of that, and the
    // longest line is the fallback for a document whose lines are all short.
    const substantial = lines.find((line) => line.length >= 40);
    const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), "");
    const chosen = substantial ?? longest;

    return chosen.length >= 12 ? chosen.slice(0, 160) : null;
}

export function createMockAiDriver(): AiDriver {
    return {
        name: "mock",
        model: "mock-1",

        // deno-lint-ignore require-await
        async ask(args: AiAskArgs): Promise<AiAskResult> {
            const question = askedQuestion(args.prompt);

            if (question.includes("__mock_429")) {
                return { ok: false, reason: "rate_limited", retryAfterSeconds: 30, detail: "mock" };
            }
            if (question.includes("__mock_500")) {
                return { ok: false, reason: "unavailable", detail: "mock" };
            }
            if (question.includes("__mock_timeout")) {
                return { ok: false, reason: "timeout", detail: "mock" };
            }
            if (question.includes("__mock_safety")) {
                return { ok: false, reason: "safety", detail: "mock" };
            }
            if (question.includes("__mock_malformed")) {
                return { ok: true, text: "this is not json", model: "mock-1" };
            }

            const real = firstRealSentence(args.prompt);

            if (question.includes("__mock_ungrounded") || !real) {
                // `grounded: true` with a citation that cannot verify. The
                // verifier must downgrade this to the fixed refusal — the exact
                // shape a hallucinating model produces.
                return {
                    ok: true,
                    model: "mock-1",
                    text: JSON.stringify({
                        answer: "The agreement terminates after ninety days.",
                        grounded: true,
                        citations: [
                            { page: 1, quote: "This agreement terminates after ninety (90) days." },
                        ],
                    }),
                };
            }

            return {
                ok: true,
                model: "mock-1",
                text: JSON.stringify({
                    answer:
                        "This is a mock answer from the local AI driver. The first quote below " +
                        "is real text from your document; the second is fabricated and should " +
                        "not appear in the panel.",
                    bullets: [
                        "AI_DRIVER=mock is set, so no model was called.",
                        "Set AI_DRIVER=gemini with a GEMINI_API_KEY for real answers.",
                    ],
                    grounded: true,
                    citations: [
                        { page: 1, quote: real },
                        { page: 1, quote: "A clause that is definitely not in this document." },
                    ],
                }),
            };
        },
    };
}
