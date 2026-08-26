import { describe, expect, it } from "vitest";
import { utils_PageSign_IdentityCheckReady } from "@/pages/Page_Sign/utils_PageSign_IdentityCheckReady";

/**
 * [ekyc] CG-033. Four cases, and the first one is the whole additive-safety
 * claim of this feature on the client side, written as an assertion.
 */
describe("utils_PageSign_IdentityCheckReady", () => {
    it("is TRUE for undefined — the case that covers every existing document", () => {
        // `signing_session_open` omits `identity_check` entirely unless a check
        // is required. An absent block means "this arm does not apply", never
        // "we could not tell" — and a browser holding a page from before CG-033
        // shipped reads `undefined` too.
        expect(utils_PageSign_IdentityCheckReady(undefined)).toBe(true);
    });

    it("is TRUE when a block exists but says no check is required", () => {
        expect(
            utils_PageSign_IdentityCheckReady({
                required: false,
                satisfied: false,
                status: "not_started",
            })
        ).toBe(true);
    });

    it("is FALSE when required and not satisfied", () => {
        expect(
            utils_PageSign_IdentityCheckReady({
                required: true,
                satisfied: false,
                status: "not_started",
            })
        ).toBe(false);
    });

    it("is FALSE for a rejection, even though a check was attempted", () => {
        expect(
            utils_PageSign_IdentityCheckReady({
                required: true,
                satisfied: false,
                status: "rejected",
                reason: "document unreadable",
            })
        ).toBe(false);
    });

    it("is TRUE only when the server itself says satisfied", () => {
        // The page never re-judges. `satisfied` is computed server-side against
        // the verdict AND its expiry, for the same reason `otp_verified` is a
        // boolean rather than a timestamp: two implementations of one rule drift.
        expect(
            utils_PageSign_IdentityCheckReady({
                required: true,
                satisfied: true,
                status: "approved",
            })
        ).toBe(true);
    });
});
