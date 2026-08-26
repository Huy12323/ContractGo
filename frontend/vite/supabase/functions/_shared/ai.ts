/**
 * The AI provider seam (CG-049).
 *
 * Mirrors `_shared/signing.ts` and `_shared/storage.ts`: a type-only interface,
 * env read lazily *inside* the factory, and a dynamic `import()` so a deployment
 * running the mock never pulls vendor code it has no credentials for.
 *
 *     getAiDriver()   "mock" | "gemini" | "off"
 *
 * DEFAULTS TO `mock`, per the rule `signing.ts` wrote down: a fresh deployment
 * must run end to end with no vendor account. The mock returns a canned answer
 * whose citation verifies and one that does not, so both sides of the verifier
 * are walkable with no API key at all.
 *
 * `off` IS A THIRD DRIVER AND NOT AN ABSENT ONE. "The assistant is disabled for
 * this deployment" is a state the endpoint has to be able to report cleanly, in
 * one branch, before it touches the database — and it must not be reachable by
 * accident (an unset `GEMINI_API_KEY` is a loud failure, not a silent
 * downgrade). A named driver makes both true.
 *
 * WHAT A DRIVER DOES NOT DO, and this is the important part: it never touches
 * the database, never reads the service-role key, never sees a signer token or
 * an email address, and never decides what goes into the prompt. It receives an
 * already-assembled request and returns text. Prompt assembly and, crucially,
 * ANSWER VERIFICATION live in `_shared/aiPrompt.ts`, which is pure and unit
 * tested. A vendor swap must never mean touching either.
 */

// ============================================================
// Shared shapes
// ============================================================

export type AiDriverName = "mock" | "gemini" | "off";

/**
 * One prior exchange, replayed to the model as context.
 *
 * ALWAYS LOADED FROM POSTGRES, NEVER FROM THE CLIENT — see the header of
 * `signing_ai_ask`. On a `verify_jwt = false` endpoint, client-supplied history
 * lets the caller author the MODEL'S OWN prior turns, which is the most reliable
 * jailbreak there is and defeats every other control at once.
 */
export type AiHistoryTurn = {
    question: string;
    answer: string;
};

export type AiAskArgs = {
    /**
     * The separate system slot, not a prefix on the user turn. Keeping the rules
     * out of the same channel as the untrusted document is the whole reason the
     * slot exists.
     */
    systemInstruction: string;
    /** Already fenced, sanitized and page-tagged by `aiPrompt.ts`. */
    prompt: string;
    history: AiHistoryTurn[];
    signal?: AbortSignal;
};

/**
 * A driver reports a typed outcome rather than throwing, because the CALLER has
 * to distinguish "refund the turn" from "charge it". A safety block was a real
 * upstream call and is charged; a timeout was not and is refunded. An exception
 * carries neither fact.
 */
export type AiAskResult =
    | { ok: true; text: string; model: string }
    | {
          ok: false;
          /**
           * rate_limited  upstream 429 — refund, and pass Retry-After through
           * unavailable   upstream 5xx after one retry — refund
           * timeout       our own deadline fired — refund
           * safety        the model declined on a safety filter — CHARGE
           * config        4xx auth/config fault on our side — refund, log loudly
           * malformed     a 200 whose body was not what the schema promised — CHARGE
           */
          reason: "rate_limited" | "unavailable" | "timeout" | "safety" | "config" | "malformed";
          /** For the operator's log. NEVER returned to the signer: an upstream
           *  error body can quote the prompt, which contains the contract. */
          detail?: string;
          retryAfterSeconds?: number;
      };

export type AiDriver = {
    name: AiDriverName;
    model: string;
    ask(args: AiAskArgs): Promise<AiAskResult>;
};

// ============================================================
// Selection
// ============================================================

export function getAiDriverName(): AiDriverName {
    const value = Deno.env.get("AI_DRIVER");
    return value === "gemini" || value === "off" ? value : "mock";
}

/**
 * The model, in one place because two things read it: the driver, and the audit
 * payload that records WHICH model answered. A default rather than a required
 * var — the free tier's flash model is the one this feature was sized for, and
 * an operator who has not thought about it should get a working deployment.
 */
export function getAiModel(): string {
    return Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
}

/**
 * Dynamic import so the mock path never loads the vendor module — the same
 * reasoning as `getSignatureDriver`.
 *
 * `off` throws rather than returning a driver that refuses, because the endpoint
 * must never reach this call: it checks the name and returns 503 before it opens
 * a session or touches a quota counter. A throw here means that check was
 * removed.
 */
export async function getAiDriver(): Promise<AiDriver> {
    const name = getAiDriverName();
    if (name === "mock") {
        const { createMockAiDriver } = await import("./ai.mock.ts");
        return createMockAiDriver();
    }
    if (name === "gemini") {
        const { createGeminiAiDriver } = await import("./ai.gemini.ts");
        return createGeminiAiDriver();
    }
    throw new Error(
        "AI_DRIVER=off — the assistant is disabled for this deployment. " +
            "The caller must refuse before constructing a driver."
    );
}
