/**
 * The Gemini driver (CG-049).
 *
 * PLAIN `fetch`, NO SDK. The request shape is forty lines, and the import map
 * that every edge function shares is a thing worth keeping small — `@google/genai`
 * would be pulled into `deno check` for functions that will never call a model.
 * The same reasoning `webhookSign.ts` used for signing its own payloads.
 *
 * ITS OWN MODULE, reached only by `getAiDriver()`'s dynamic import, so a
 * deployment on `AI_DRIVER=mock` never parses this file.
 *
 * WHAT IT DOES NOT DO: it does not build the prompt, does not verify the answer
 * and does not know what a citation is. It hands `systemInstruction`, `history`
 * and `prompt` to the model and returns the raw text. Everything that decides
 * whether a signer sees that text lives in `aiPrompt.ts`, which is pure.
 */

import { requireEnv } from "./http.ts";
import type { AiAskArgs, AiAskResult, AiDriver } from "./ai.ts";
import { getAiModel } from "./ai.ts";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The JSON the model is REQUIRED to return. Constrained decoding rather than
 * "please answer in JSON", because a prose answer that has to be parsed is a
 * parser on the signing surface, and the failure mode of that parser is a blank
 * panel in front of someone about to sign.
 *
 * `citations` is the load-bearing field: `quote` must be VERBATIM, because the
 * verifier tests it as a literal substring of the cached page text and drops it
 * otherwise. The schema cannot make the model honest — the verifier does — but
 * asking for a quote is what makes the verifier's job possible at all.
 */
const RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        answer: { type: "STRING" },
        bullets: { type: "ARRAY", items: { type: "STRING" } },
        citations: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    page: { type: "INTEGER" },
                    quote: { type: "STRING" },
                },
                required: ["page", "quote"],
            },
        },
        grounded: { type: "BOOLEAN" },
        refusal_reason: { type: "STRING" },
    },
    required: ["answer", "grounded"],
};

/**
 * BLOCK_ONLY_HIGH ON ALL FOUR, and this is a deliberate loosening.
 *
 * Real contracts talk about termination for cause, indemnity against death and
 * personal injury, liquidated damages, and — in an NDA or an employment
 * agreement — harassment. At the default threshold those trip HARASSMENT and
 * DANGEROUS_CONTENT often enough that the assistant would refuse to explain the
 * clauses a signer most needs explained. A safety block on a legitimate legal
 * document is not a safe product; it is a broken one.
 *
 * The loosening is bounded by what the model can do here: it has no tools, no
 * search, one information source, and every factual claim it makes is dropped
 * unless it carries a quote that exists in the document the signer is holding.
 */
const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

type GeminiPart = { text?: string };
type GeminiResponse = {
    candidates?: Array<{
        content?: { parts?: GeminiPart[] };
        finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
};

export function createGeminiAiDriver(): AiDriver {
    // Read INSIDE the factory, never at module scope: `storage.ts:86` is the
    // cautionary tale that made `tests/setup/deno-shim.ts` load-order-sensitive.
    const apiKey = requireEnv("GEMINI_API_KEY");
    const model = getAiModel();

    return {
        name: "gemini",
        model,

        async ask(args: AiAskArgs): Promise<AiAskResult> {
            const body = {
                systemInstruction: { parts: [{ text: args.systemInstruction }] },
                // History first, question last. The document lives inside
                // `prompt`, at the front — prefix stability across turns is what
                // earns an implicit context-cache hit, which on a free tier is
                // the difference between a usable feature and a quota fire.
                contents: [
                    ...args.history.flatMap((turn) => [
                        { role: "user", parts: [{ text: turn.question }] },
                        { role: "model", parts: [{ text: turn.answer }] },
                    ]),
                    { role: "user", parts: [{ text: args.prompt }] },
                ],
                generationConfig: {
                    // Zero, not low. Two signers asking the same question about
                    // the same clause should get the same answer, and an
                    // evidentiary product has no use for creative variance.
                    temperature: 0,
                    maxOutputTokens: 800,
                    responseMimeType: "application/json",
                    responseSchema: RESPONSE_SCHEMA,
                    // Reading comprehension over a document already in context
                    // does not need much thinking, and the budget is paid for in
                    // latency the signer waits through.
                    //
                    // `thinkingLevel`, NOT the `thinkingBudget: 0` this used to
                    // send: Gemini 3 dropped the numeric budget and rejects it
                    // with a bare 400 INVALID_ARGUMENT that names no field.
                    // `minimal` is the floor — thinking cannot be turned off.
                    thinkingConfig: { thinkingLevel: "minimal" },
                },
                safetySettings: SAFETY_SETTINGS,
                // No `tools`. The model has exactly one information source: the
                // document text in the prompt. Search grounding would let an
                // answer about THIS contract be sourced from the open web, which
                // is the failure this whole design exists to prevent.
            };

            let res: Response;
            try {
                res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                    signal: args.signal,
                });
            } catch (err) {
                // `AbortSignal.timeout()` rejects with a DOMException named
                // **TimeoutError**, not AbortError — only `controller.abort()`
                // produces the latter. Matching AbortError alone classified every
                // deadline as `unavailable`, so a slow upstream reached the signer
                // as "the assistant is unavailable" (502) instead of "that took too
                // long, please ask again" (504): the wrong message, and the wrong
                // signal to the operator reading the failure column.
                //
                // `signal.aborted` is the belt to that braces — a runtime that
                // reports the abort as a plain Error still lands on `timeout`.
                const aborted =
                    (err instanceof DOMException &&
                        (err.name === "TimeoutError" || err.name === "AbortError")) ||
                    args.signal?.aborted === true;
                return {
                    ok: false,
                    reason: aborted ? "timeout" : "unavailable",
                    detail: String(err),
                };
            }

            if (!res.ok) {
                // Drained and kept for the OPERATOR'S log only. An upstream error
                // body quotes the request, and the request contains the contract.
                const detail = (await res.text().catch(() => "")).slice(0, 500);

                if (res.status === 429) {
                    const header = res.headers.get("retry-after");
                    const parsed = header ? Number.parseInt(header, 10) : NaN;
                    return {
                        ok: false,
                        reason: "rate_limited",
                        retryAfterSeconds: Number.isFinite(parsed) ? parsed : 60,
                        detail,
                    };
                }
                if (res.status >= 500) {
                    return { ok: false, reason: "unavailable", detail };
                }
                // 400/401/403 here mean a bad key, a disabled API or a model name
                // that does not exist — our configuration, not the signer's
                // input. Distinct from `unavailable` so it can be logged as the
                // deployment fault it is.
                return { ok: false, reason: "config", detail: `${res.status} ${detail}` };
            }

            let json: GeminiResponse;
            try {
                json = (await res.json()) as GeminiResponse;
            } catch (err) {
                return { ok: false, reason: "malformed", detail: String(err) };
            }

            if (json.promptFeedback?.blockReason) {
                return {
                    ok: false,
                    reason: "safety",
                    detail: json.promptFeedback.blockReason,
                };
            }

            const candidate = json.candidates?.[0];
            const finish = candidate?.finishReason;
            if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
                return { ok: false, reason: "safety", detail: finish };
            }

            const text = (candidate?.content?.parts ?? [])
                .map((part) => part.text ?? "")
                .join("")
                .trim();

            if (!text) {
                // Includes MAX_TOKENS with an empty first part and RECITATION.
                // Charged rather than refunded: the call happened and the quota
                // was spent upstream whatever we do about it here.
                return { ok: false, reason: "malformed", detail: `empty candidate (${finish})` };
            }

            return { ok: true, text, model };
        },
    };
}
