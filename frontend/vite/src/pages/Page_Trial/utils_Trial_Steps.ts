// The trial's three steps, and the rules for moving between them.
//
// THREE, NOT FOUR — placing fields and filling them are one step here. In the
// real product those are two people on two days, which is why `Page_Sign` and
// `Page_TemplateBuilder` are separate surfaces. In the trial it is one person in
// one minute, and splitting them would introduce "who is this field for?" as a
// question that has no meaning with a single party.
//
// Kept as pure functions beside the page rather than inline in it, following
// `utils_PageSign_Steps.ts`: "can I advance?" is the rule most likely to be
// wrong and the cheapest thing in the flow to test.

import type { TemplateLayout } from "@/types/template.types";
import { const_Trial_MaxFields, const_Trial_MaxPages } from "@/utils/pdf/const_TrialLimits";

export type Trial_Step = "upload" | "place" | "sign";

export const const_Trial_Steps: Trial_Step[] = ["upload", "place", "sign"];

export const const_Trial_StepLabels: Record<Trial_Step, string> = {
    upload: "Upload",
    place: "Place & fill",
    sign: "Sign & download",
};

export const utils_Trial_StepIndex = (step: Trial_Step): number => const_Trial_Steps.indexOf(step);

/** Field types the trial offers. See `App_TemplateFieldPalette`'s `allowedTypes`. */
export const const_Trial_FieldTypes = ["signature", "text", "date"] as const;

/**
 * Why the visitor cannot continue yet, or `null` if they can.
 *
 * Returns a REASON rather than a boolean because every caller needs one: the
 * Continue button is disabled with a tooltip explaining itself, and a disabled
 * button with no explanation is the most common way a demo loses someone.
 */
export const utils_Trial_BlockedReason = (args: {
    step: Trial_Step;
    hasFile: boolean;
    layout: TemplateLayout;
    numPages: number;
    signature: string | null;
}): string | null => {
    const { step, hasFile, layout, numPages, signature } = args;

    if (step === "upload") {
        return hasFile ? null : "Upload a PDF to continue";
    }

    if (step === "place") {
        if (layout.length === 0) return "Place at least one field on the document";
        if (layout.length > const_Trial_MaxFields) {
            return `The trial is limited to ${const_Trial_MaxFields} fields`;
        }
        // Checked on ADVANCE rather than on upload: the page count is only known
        // once pdf.js has parsed the document, by which point refusing the file
        // would mean throwing away work the visitor has already done.
        if (numPages > const_Trial_MaxPages) {
            return `The trial is limited to ${const_Trial_MaxPages} pages`;
        }
        return null;
    }

    return signature ? null : "Add your signature to continue";
};

/**
 * Fields the visitor has to fill in the document, in the order they read.
 *
 * Signature fields are excluded: they are satisfied on the sign step, which is
 * the same split `utils_Signing_IsSignatureField` makes in the real ceremony.
 */
export const utils_Trial_FillableFields = (layout: TemplateLayout): TemplateLayout =>
    [...layout]
        .filter((f) => f.type !== "signature" && f.type !== "initials")
        .sort((a, b) => a.page - b.page || a.y_pct - b.y_pct || a.x_pct - b.x_pct);
