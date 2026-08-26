import { describe, expect, it } from "vitest";
import {
    utils_PageSign_StepIndex,
    utils_PageSign_Steps,
    type PageSign_Step,
} from "@/pages/Page_Sign/utils_PageSign_Steps";

/**
 * [ekyc] THE MOST VALUABLE TEST v1.2.0 ADDS, and the only reason extracting the
 * `Steps` chrome out of `Page_Sign` was an acceptable risk.
 *
 * `Page_Sign` used to carry a literal three-element `items` array and a literal
 * `stepIndex` ternary. CG-033 made both conditional. If that conditional is ever
 * wrong, EVERY envelope — none of which uses eKYC today — renumbers its signing
 * ceremony, so a signer reading the document sees the wrong step highlighted.
 * There is no component test in this repo to catch that (see `docs/testing.md`
 * for why), so it is caught here, by pinning the no-eKYC case to exactly what
 * shipped.
 */
describe("utils_PageSign_Steps", () => {
    it("is BYTE-FOR-BYTE the three steps that shipped when no check is required", () => {
        expect(utils_PageSign_Steps(false)).toEqual([
            { title: "Review" },
            { title: "Complete fields" },
            { title: "Sign" },
        ]);
    });

    it("inserts the identity step between Review and Complete fields", () => {
        // The position is the design, not a layout choice: the document stays
        // readable first, and a rejection lands before the signer has filled a
        // document and drawn a signature only the browser is holding.
        expect(utils_PageSign_Steps(true).map((s) => s.title)).toEqual([
            "Review",
            "Verify identity",
            "Complete fields",
            "Sign",
        ]);
    });
});

describe("utils_PageSign_StepIndex", () => {
    it("pins the shipped numbering when no check is required", () => {
        expect(utils_PageSign_StepIndex("welcome", false)).toBe(0);
        expect(utils_PageSign_StepIndex("fill", false)).toBe(1);
        expect(utils_PageSign_StepIndex("sign", false)).toBe(2);
    });

    it("keeps the terminal steps on the last index, as the old ternary did", () => {
        // `complete` and `declined` fell through to 2 in the literal this
        // replaced. They render inside the same frame, so the chrome has to say
        // something, and "Sign" is the step they arrived from.
        expect(utils_PageSign_StepIndex("complete", false)).toBe(2);
        expect(utils_PageSign_StepIndex("declined", false)).toBe(2);
    });

    it("shifts everything by one once the identity step exists", () => {
        expect(utils_PageSign_StepIndex("welcome", true)).toBe(0);
        expect(utils_PageSign_StepIndex("identity", true)).toBe(1);
        expect(utils_PageSign_StepIndex("fill", true)).toBe(2);
        expect(utils_PageSign_StepIndex("sign", true)).toBe(3);
    });

    it("never returns an index outside the rendered item list", () => {
        // The failure this whole file exists to prevent: a highlighted step that
        // is not on screen.
        const steps: PageSign_Step[] = [
            "welcome",
            "identity",
            "fill",
            "sign",
            "complete",
            "declined",
        ];
        for (const needsIdentity of [false, true]) {
            const count = utils_PageSign_Steps(needsIdentity).length;
            for (const step of steps) {
                const index = utils_PageSign_StepIndex(step, needsIdentity);
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(count);
            }
        }
    });
});
