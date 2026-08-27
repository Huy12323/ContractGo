import { describe, expect, it } from "vitest";
import {
    buildSignerRows,
    resolveRecipientAuth,
    resolveRecipientIdentityCheck,
    resolveRequireIdentityCheck,
    resolveSignerAuth,
} from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * CG-031. `resolveSignerAuth` decides what a document's signatures will rest on,
 * from a field an older client may not send at all — so the two behaviours worth
 * pinning are both about ABSENCE and about NONSENSE, not about the happy path.
 *
 * Pure, so it is testable here at all: `docs/testing.md` keeps anything needing a
 * real SupabaseClient out of the unit silo, which is why `assertSignerIdentity`
 * (the other half of this feature) is verified end to end instead.
 */

const resolve = (body: Record<string, unknown>) => resolveSignerAuth(body as never);

describe("resolveSignerAuth", () => {
    it("defaults to the stricter option when the key is absent", () => {
        // The compatibility case, and the one that matters most: a client built
        // before this feature sends no `signer_auth` at all, and must keep
        // getting the behaviour it has always had rather than silently
        // downgrading its documents to passcode signing.
        expect(resolve({})).toBe("account");
    });

    it("treats an explicit null as absent rather than as a choice", () => {
        // Unlike `expires_at`, where null is a deliberate "no deadline", there is
        // no third state to express here — so null is a client that meant to say
        // nothing, and it fails closed like saying nothing.
        expect(resolve({ signer_auth: null })).toBe("account");
    });

    it("passes both known values through", () => {
        expect(resolve({ signer_auth: "account" })).toBe("account");
        expect(resolve({ signer_auth: "email_otp" })).toBe("email_otp");
    });

    it("refuses an unrecognised value instead of coercing it", () => {
        // The whole point of throwing rather than defaulting. Coercion would mean
        // a typo'd or malicious value quietly resolves to SOME authentication
        // setting, and the sender is never told which one they got.
        expect(() => resolve({ signer_auth: "none" })).toThrow(/Unknown signer_auth/);
        expect(() => resolve({ signer_auth: "" })).toThrow(/Unknown signer_auth/);
        expect(() => resolve({ signer_auth: true })).toThrow(/Unknown signer_auth/);
    });

    it("does not accept a value that merely looks close", () => {
        // Case and spelling are exact. `EMAIL_OTP` reaching the database as an
        // enum would raise a constraint error three writes later, which the
        // sender would see as a 500 rather than as a sentence.
        expect(() => resolve({ signer_auth: "EMAIL_OTP" })).toThrow(/Unknown signer_auth/);
        expect(() => resolve({ signer_auth: "otp" })).toThrow(/Unknown signer_auth/);
    });
});

/**
 * CG-050 added the ORG DEFAULT between the request body and the hard-coded
 * fallback: body > organization > 'account'.
 */
describe("resolveSignerAuth — organization default", () => {
    it("uses the org default when the body says nothing", () => {
        expect(resolveSignerAuth({} as never, "email_otp")).toBe("email_otp");
        expect(resolveSignerAuth({ signer_auth: null } as never, "email_otp")).toBe("email_otp");
    });

    it("lets an explicit choice outrank the org default in both directions", () => {
        // Both directions matter. An org defaulting to passcodes must still be
        // able to send an account-bound document, and vice versa — a house
        // policy is a starting point, not a ceiling.
        expect(resolveSignerAuth({ signer_auth: "account" } as never, "email_otp")).toBe("account");
        expect(resolveSignerAuth({ signer_auth: "email_otp" } as never, "account")).toBe(
            "email_otp"
        );
    });

    it("still fails closed to 'account' when no org default is supplied", () => {
        // The parameter's default. Every pre-CG-050 call site keeps its exact
        // previous meaning, which is what let this ship without touching them.
        expect(resolveSignerAuth({} as never)).toBe("account");
    });

    it("does not let the org default rescue an unrecognised value", () => {
        // An org default is a fallback for ABSENCE, never for NONSENSE. Coercing
        // a typo to the house policy would be the exact silent-choice failure
        // the base function throws to avoid.
        expect(() => resolveSignerAuth({ signer_auth: "none" } as never, "email_otp")).toThrow(
            /Unknown signer_auth/
        );
    });
});

/**
 * CG-032. Its sibling above, one level down — and the one behaviour that must
 * NOT match: an absent value here means INHERIT, not "account". Defaulting to
 * the stricter option the way `resolveSignerAuth` does would silently override
 * every recipient on every `email_otp` envelope any existing client sends.
 */
const resolveRecipient = (recipient: Record<string, unknown>) =>
    resolveRecipientAuth(recipient as never);

describe("resolveRecipientAuth", () => {
    it("means INHERIT when the key is absent — deliberately not 'account'", () => {
        // The entire additive-safety claim of CG-032. Every client that predates
        // it sends no `auth_method`, and every recipient must keep resolving to
        // the envelope-level choice that was pinned at send time.
        expect(resolveRecipient({})).toBeNull();
    });

    it("treats an explicit null as inherit, which is what the composer sends", () => {
        // `buildPayload` always sends the key explicitly, `null` for "no
        // exception", for the same reason it always sends `expires_at`.
        expect(resolveRecipient({ auth_method: null })).toBeNull();
    });

    it("passes both known values through", () => {
        expect(resolveRecipient({ auth_method: "account" })).toBe("account");
        expect(resolveRecipient({ auth_method: "email_otp" })).toBe("email_otp");
    });

    it("refuses an unrecognised value instead of coercing it", () => {
        // Same discipline as its sibling: "we did not understand what you asked
        // for, so we picked one" is the wrong answer about an auth setting. This
        // is also what stops the composer's `__inherit__` sentinel — if it ever
        // escaped `const_EnvelopeRecipientAuthOptions` — reaching an enum column.
        expect(() => resolveRecipient({ auth_method: "__inherit__" })).toThrow(
            /Unknown recipient auth_method/
        );
        expect(() => resolveRecipient({ auth_method: "none" })).toThrow(
            /Unknown recipient auth_method/
        );
        expect(() => resolveRecipient({ auth_method: "EMAIL_OTP" })).toThrow(
            /Unknown recipient auth_method/
        );
    });
});

describe("buildSignerRows — auth_method", () => {
    const build = (recipients: Record<string, unknown>[]) =>
        buildSignerRows({
            requestId: "sgr_test",
            organizationId: "org_test",
            recipients: recipients as never,
            signerRoles: [{ id: "rol_a", name: "Party", order: 1 }] as never,
        });

    it("carries a signer's exception onto the row", () => {
        const [row] = build([
            { role_id: "rol_a", name: "A", email: "a@example.test", auth_method: "account" },
        ]);
        expect(row.auth_method).toBe("account");
    });

    it("leaves NULL when the recipient has no exception", () => {
        const [row] = build([{ role_id: "rol_a", name: "A", email: "a@example.test" }]);
        expect(row.auth_method).toBeNull();
    });

    it("CLAMPS a cc to NULL rather than letting the CHECK raise", () => {
        // `signature_request_signers_auth_method_check` refuses this in the
        // database. Clamping here means a client bug is a null instead of a
        // constraint-name 500 — the same treatment `role_id` gets on the line
        // above it, and the reason an observer's control is never rendered.
        const [row] = build([
            { recipient_type: "cc", name: "O", email: "o@example.test", auth_method: "email_otp" },
        ]);
        expect(row.recipient_type).toBe("cc");
        expect(row.auth_method).toBeNull();
    });

    it("[ekyc] clamps a cc's identity requirement to NULL too", () => {
        const [row] = build([
            {
                recipient_type: "cc",
                name: "O",
                email: "o@example.test",
                require_identity_check: true,
            },
        ]);
        expect(row.require_identity_check).toBeNull();
    });
});

/**
 * [ekyc] CG-033. Its default is the OPPOSITE of `resolveSignerAuth`'s, and that
 * is the one thing worth pinning: that one defaults to the STRICTER option
 * because "we could not tell" must not weaken a signature, while this must
 * default to NOT REQUIRED because an identity check nobody asked for is a wall in
 * front of a contract — and because every client that predates CG-033 omits the
 * key, so any other default would retroactively gate every send in the system.
 */
describe("resolveRequireIdentityCheck", () => {
    const resolve = (body: Record<string, unknown>) => resolveRequireIdentityCheck(body as never);

    it("is FALSE when the key is absent — every client that predates CG-033", () => {
        expect(resolve({})).toBe(false);
    });

    it("treats an explicit null as absent", () => {
        expect(resolve({ require_identity_check: null })).toBe(false);
    });

    it("passes both booleans through", () => {
        expect(resolve({ require_identity_check: true })).toBe(true);
        expect(resolve({ require_identity_check: false })).toBe(false);
    });

    it("refuses a non-boolean instead of coercing it", () => {
        // Same discipline as `resolveSignerAuth`, in the other direction: a
        // truthy string must not quietly switch a document to requiring a
        // government ID, and a falsy one must not quietly switch it off.
        expect(() => resolve({ require_identity_check: "true" })).toThrow(
            /Unknown require_identity_check/
        );
        expect(() => resolve({ require_identity_check: 1 })).toThrow(
            /Unknown require_identity_check/
        );
        expect(() => resolve({ require_identity_check: "" })).toThrow(
            /Unknown require_identity_check/
        );
    });
});

describe("resolveRecipientIdentityCheck", () => {
    const resolve = (r: Record<string, unknown>) => resolveRecipientIdentityCheck(r as never);

    it("means INHERIT when absent, not 'not required'", () => {
        // The distinction is real: NULL tracks the envelope, `false` overrides
        // it. A recipient explicitly exempted must stay exempt even if the
        // sender later turns the requirement on for the document.
        expect(resolve({})).toBeNull();
        expect(resolve({ require_identity_check: null })).toBeNull();
    });

    it("distinguishes an explicit false from inherit", () => {
        expect(resolve({ require_identity_check: false })).toBe(false);
        expect(resolve({ require_identity_check: true })).toBe(true);
    });

    it("refuses a non-boolean", () => {
        expect(() => resolve({ require_identity_check: "yes" })).toThrow(
            /Unknown recipient require_identity_check/
        );
    });
});
