import type { Signing_Ask_Citation, UseM_Signing_Ask_Result } from "@/hooks/useM_Signing_Ask";

/**
 * Turns whatever came back on the wire into something the panel can always
 * render — CG-049.
 *
 * THIS FILE STANDS BETWEEN A MALFORMED MODEL RESPONSE AND A BLANK SIGNING
 * SURFACE, which is why it is pure, unit tested, and treats its input as
 * `unknown` rather than as the declared result type. The server verifies quotes
 * and clamps lengths before it answers, so in practice the shape is already
 * good; this exists for the case where it is not. Every branch is a clamp or a
 * drop, and NOTHING HERE THROWS — an exception on this path means a signer
 * staring at an empty panel next to a signature button.
 *
 * Degradation always runs toward LESS confidence, never toward more: a
 * non-boolean `grounded` becomes `false` (which renders "check the document"),
 * never `true`.
 */

export type SigningAssistant_Answer = {
    answer: string;
    bullets: string[];
    citations: Signing_Ask_Citation[];
    grounded: boolean;
    turnsRemaining: number | null;
    disclaimer: string | null;
};

/** A hallucinated wall of text must not blow out a 380px rail. */
const MAX_QUOTE_CHARS = 400;
const MAX_BULLETS = 8;
const MAX_CITATIONS = 4;

export const utils_SigningAssistant_NormalizeAnswer = (
    raw: unknown
): SigningAssistant_Answer | null => {
    if (!raw || typeof raw !== "object") return null;

    const result = raw as Partial<UseM_Signing_Ask_Result>;

    // A non-string answer is not recoverable into anything worth showing, so the
    // caller renders an error turn instead of an empty bubble.
    if (typeof result.answer !== "string" || result.answer.trim().length === 0) return null;

    const bullets = Array.isArray(result.bullets)
        ? result.bullets
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((item) => item.trim())
              .slice(0, MAX_BULLETS)
        : [];

    const citations = Array.isArray(result.citations)
        ? result.citations
              .filter((item): item is Signing_Ask_Citation => !!item && typeof item === "object")
              .map((item) => {
                  const page = typeof item.page === "number" ? Math.trunc(item.page) : 0;
                  const quote = typeof item.quote === "string" ? item.quote.trim() : "";
                  return { page, quote };
              })
              // A quote with a bad page number KEEPS THE QUOTE and loses the
              // jump button (page 0 is rendered as unlinked). Dropping the whole
              // citation would discard verified evidence over a broken affordance.
              .filter((item) => item.quote.length > 0)
              .map((item) => ({
                  page: item.page > 0 ? item.page : 0,
                  quote: item.quote.slice(0, MAX_QUOTE_CHARS),
              }))
              .slice(0, MAX_CITATIONS)
        : [];

    return {
        answer: result.answer.trim(),
        bullets,
        citations,
        grounded: result.grounded === true,
        turnsRemaining: typeof result.turns_remaining === "number" ? result.turns_remaining : null,
        disclaimer: typeof result.disclaimer === "string" ? result.disclaimer : null,
    };
};
