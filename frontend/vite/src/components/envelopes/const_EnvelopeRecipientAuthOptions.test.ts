import { describe, expect, it } from "vitest";
import {
    const_Envelope_AuthInherit,
    utils_Envelope_AuthFromSelect,
    utils_Envelope_AuthToSelect,
    utils_Envelope_RecipientAuthOptions,
} from "@/components/envelopes/const_EnvelopeRecipientAuthOptions";

/**
 * CG-032. `null` and the ANTD sentinel are two spellings of "inherit" that must
 * never be confused: state and the wire speak `null`, the `Select` speaks
 * `__inherit__`, and the only place the second exists is between these two
 * translations. A leak in either direction writes the literal string
 * `"__inherit__"` into a Postgres enum column.
 */
describe("const_EnvelopeRecipientAuthOptions", () => {
    it("round-trips null through the select and back", () => {
        expect(utils_Envelope_AuthToSelect(null)).toBe(const_Envelope_AuthInherit);
        expect(utils_Envelope_AuthFromSelect(const_Envelope_AuthInherit)).toBeNull();
    });

    it("treats undefined the same as null — a recipient with no exception yet", () => {
        expect(utils_Envelope_AuthToSelect(undefined)).toBe(const_Envelope_AuthInherit);
    });

    it("round-trips both real enum values unchanged", () => {
        for (const value of ["account", "email_otp"] as const) {
            expect(utils_Envelope_AuthToSelect(value)).toBe(value);
            expect(utils_Envelope_AuthFromSelect(value)).toBe(value);
        }
    });

    it("NEVER offers the sentinel as an enum value", () => {
        // The assertion that matters. `resolveRecipientAuth` refuses the sentinel
        // server-side as a second line of defence, but this is the first: the
        // sentinel appears exactly once in the option list, as the inherit row,
        // and every other option is a real member of
        // `signature_requests_signer_auth_enum`.
        for (const inherited of ["account", "email_otp"] as const) {
            const options = utils_Envelope_RecipientAuthOptions(inherited);
            const sentinels = options.filter((o) => o.value === const_Envelope_AuthInherit);
            expect(sentinels).toHaveLength(1);
            expect(options[0]!.value).toBe(const_Envelope_AuthInherit);
            expect(
                options
                    .slice(1)
                    .map((o) => o.value)
                    .sort()
            ).toEqual(["account", "email_otp"]);
        }
    });

    it("names the envelope-level choice in the inherit label", () => {
        // The wizard reaches Recipients BEFORE Prepare, so an unlabelled "Same as
        // everyone" would ask the sender to except from a default they have not
        // seen yet.
        const forOtp = utils_Envelope_RecipientAuthOptions("email_otp")[0]!.label;
        const forAccount = utils_Envelope_RecipientAuthOptions("account")[0]!.label;
        expect(forOtp).toMatch(/^Same as everyone — /);
        expect(forAccount).toMatch(/^Same as everyone — /);
        expect(forOtp).not.toBe(forAccount);
    });
});
