import type { Signing_Session } from "@/hooks/useQ_Signing_Session";

/**
 * Four opening questions for the assistant's empty state — CG-049.
 *
 * PURE AND DETERMINISTIC: the same session always yields the same four, so a
 * reload does not reshuffle the chips under a finger already moving toward one.
 *
 * DERIVED FROM LABELS, NEVER FROM VALUES. A field's LABEL ("Annual salary") is
 * a question worth offering; a field's VALUE is contract data, and putting it on
 * a chip would print the number onto the page before the signer asked anything.
 * The unit test asserts no field value ever appears here.
 *
 * Always exactly four. Fewer looks broken; more turns a nudge into a menu, and
 * the point of the empty state is to get the first question asked.
 */

/** Ordered by how often they are the real question a hesitating signer has. */
const GENERIC = [
    "What am I agreeing to?",
    "How long does this last, and how do I end it?",
    "What do I have to do, and by when?",
    "Are there any fees, penalties or automatic renewals?",
    "What happens if something goes wrong?",
];

export const utils_SigningAssistant_StarterQuestions = (session: Signing_Session): string[] => {
    const questions: string[] = ["What am I agreeing to?"];

    // The signer's OWN fields, in document order. "What do I put here?" is the
    // most common real question on this surface and the one the document text
    // alone cannot answer, because the boxes are an overlay on it.
    const myLabels = session.fields
        .filter((field) => field.role_id === session.signer.role_id && field.type !== "signature")
        .map((field) => field.label.trim())
        .filter((label) => label.length > 0 && label.length <= 60);

    const seen = new Set<string>();
    for (const label of myLabels) {
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        questions.push(`What should I put in "${label}"?`);
        if (questions.length === 3) break;
    }

    for (const generic of GENERIC) {
        if (questions.length === 4) break;
        if (!questions.includes(generic)) questions.push(generic);
    }

    return questions.slice(0, 4);
};
