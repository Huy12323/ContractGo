import { describe, expect, it } from "vitest";
import { utils_SigningAssistant_StarterQuestions } from "@/components/signing/utils_SigningAssistant_StarterQuestions";
import type { Signing_Field, Signing_Session } from "@/hooks/useQ_Signing_Session";

/**
 * The four chips in the empty state.
 *
 * One assertion here is a privacy rule and not a preference: a starter question
 * may be derived from a field's LABEL, never from its VALUE. A chip reading
 * `What should I put in "Annual salary: 92,000"?` would print contract data onto
 * the panel before the signer had asked anything at all.
 */

const field = (over: Partial<Signing_Field>): Signing_Field => ({
    id: "f1",
    key: "k",
    label: "Full name",
    type: "text",
    role_id: "role_signer",
    required: true,
    page: 1,
    x_pct: 0,
    y_pct: 0,
    w_pct: 10,
    h_pct: 5,
    editable: true,
    ...over,
});

const session = (fields: Signing_Field[]): Signing_Session =>
    ({
        request: {
            id: "r1",
            title: "Employment Agreement",
            status: "in_progress",
            current_order: 1,
        },
        signer: {
            id: "s1",
            name: "Jordan",
            email: "jordan@example.com",
            role_id: "role_signer",
            signer_order: 1,
            status: "viewed",
            changes_requested_reason: null,
        },
        signer_roles: [],
        fields,
        field_values: { f1: "Jordan Reyes", f2: "92,000" },
        other_field_values: {},
        pdf_url: "https://example.test/doc.pdf",
        can_sign: true,
    }) as Signing_Session;

describe("utils_SigningAssistant_StarterQuestions", () => {
    it("always returns exactly four", () => {
        expect(utils_SigningAssistant_StarterQuestions(session([]))).toHaveLength(4);
        expect(
            utils_SigningAssistant_StarterQuestions(
                session(
                    Array.from({ length: 12 }, (_, i) =>
                        field({ id: `f${i}`, label: `Field ${i}` })
                    )
                )
            )
        ).toHaveLength(4);
    });

    it("is deterministic — a reload must not reshuffle chips under a moving finger", () => {
        const input = session([field({}), field({ id: "f2", label: "Annual salary" })]);
        expect(utils_SigningAssistant_StarterQuestions(input)).toEqual(
            utils_SigningAssistant_StarterQuestions(input)
        );
    });

    it("uses field LABELS", () => {
        const questions = utils_SigningAssistant_StarterQuestions(
            session([field({ label: "Annual salary", id: "f2" })])
        );
        expect(questions.some((q) => q.includes("Annual salary"))).toBe(true);
    });

    it("NEVER includes a field value", () => {
        const questions = utils_SigningAssistant_StarterQuestions(
            session([field({}), field({ id: "f2", label: "Annual salary" })])
        );
        for (const question of questions) {
            expect(question).not.toContain("Jordan Reyes");
            expect(question).not.toContain("92,000");
        }
    });

    it("ignores other roles' fields and signature boxes", () => {
        const questions = utils_SigningAssistant_StarterQuestions(
            session([
                field({ id: "f2", label: "Counterparty reference", role_id: "role_other" }),
                field({ id: "f3", label: "Your signature", type: "signature" }),
            ])
        );

        expect(questions.some((q) => q.includes("Counterparty reference"))).toBe(false);
        expect(questions.some((q) => q.includes("Your signature"))).toBe(false);
    });

    it("falls back to generic questions when there are no fields", () => {
        const questions = utils_SigningAssistant_StarterQuestions(session([]));
        expect(questions[0]).toBe("What am I agreeing to?");
        expect(new Set(questions).size).toBe(4);
    });
});
