/**
 * [ekyc] The signing ceremony's step chrome — CG-033.
 *
 * WHY THIS EXISTS AT ALL. `Page_Sign` used to carry a literal three-element
 * `Steps items` array and a literal `stepIndex` ternary. Adding a CONDITIONAL
 * fourth step to those in place is the single riskiest edit in v1.2.0: get it
 * wrong and every envelope not using eKYC — which is all of them — renumbers its
 * ceremony, so a signer reading the document sees "Complete fields" highlighted.
 *
 * Extracting it is what makes that risk acceptable, because it can then be
 * PINNED BY A UNIT TEST. `utils_PageSign_Steps.test.ts` asserts that
 * `utils_PageSign_Steps(false)` is exactly the three titles that shipped, in
 * order, and that the indices are `welcome→0, fill→1, sign→2`. That test is the
 * regression guard; without it this extraction would be a net loss.
 *
 * Removing eKYC deletes this file and its test and restores the two literals.
 */

/**
 * Mirrors `Page_Sign`'s own `Step`, terminal states included.
 *
 * `complete` and `declined` are in here because the shipped literal ternary put
 * them on the LAST index — they render inside the same frame as the ceremony, so
 * the chrome has to say something, and "Sign" is the step they arrived from.
 * Dropping them would have been a behaviour change dressed as a type cleanup.
 */
export type PageSign_Step = "welcome" | "identity" | "fill" | "sign" | "complete" | "declined";

/**
 * The step titles, in ceremony order.
 *
 * The identity step sits between Review and Complete fields deliberately: the
 * document stays readable FIRST (both existing gates state that principle in
 * their headers), nothing valuable is in local state yet at the end of Review,
 * and a rejection must land before the signer has filled a document and drawn a
 * signature that only the browser is holding.
 */
export const utils_PageSign_Steps = (needsIdentity: boolean): { title: string }[] =>
    needsIdentity
        ? [
              { title: "Review" },
              { title: "Verify identity" },
              { title: "Complete fields" },
              { title: "Sign" },
          ]
        : [{ title: "Review" }, { title: "Complete fields" }, { title: "Sign" }];

/**
 * Which of the above is current.
 *
 * EVERYTHING THAT IS NOT `welcome` OR `fill` FALLS TO THE LAST INDEX, which is
 * exactly what the shipped ternary did (`step === "welcome" ? 0 : step === "fill"
 * ? 1 : 2`). `sign`, `complete` and `declined` all landed on 2 there and all land
 * on the last one here.
 *
 * `identity` maps to 0 when no identity step is rendered — unreachable, since
 * `Page_Sign` never enters that step unless one is required, but answered
 * defensively rather than with a cast: the cost of being wrong is a highlighted
 * step that does not exist.
 */
export const utils_PageSign_StepIndex = (step: PageSign_Step, needsIdentity: boolean): number => {
    if (!needsIdentity) {
        return step === "welcome" ? 0 : step === "fill" ? 1 : step === "identity" ? 0 : 2;
    }
    return step === "welcome" ? 0 : step === "identity" ? 1 : step === "fill" ? 2 : 3;
};
