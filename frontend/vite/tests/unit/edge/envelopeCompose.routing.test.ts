import { describe, expect, it } from "vitest";
import {
    CC_SIGNER_ORDER,
    buildSignerRows,
    firstSignerOrder,
    isCc,
    isEmptyRecipient,
} from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * The routing core. This is the bug class that produces "the wrong person
 * received the document first" — invisible in a UI review, legally significant,
 * and entirely decidable from pure functions.
 */

const ROLES = [
    { id: "rol_sender", name: "Sender", order: 0 },
    { id: "rol_a", name: "Party A", order: 1 },
    { id: "rol_b", name: "Party B", order: 1 },
    { id: "rol_c", name: "Party C", order: 2 },
] as never as Parameters<typeof buildSignerRows>[0]["signerRoles"];

const build = (recipients: unknown[]) =>
    buildSignerRows({
        requestId: "sr_1",
        organizationId: "org_1",
        recipients: recipients as never,
        signerRoles: ROLES,
    });

describe("isCc", () => {
    it("is true only for recipient_type 'cc'", () => {
        expect(isCc({ recipient_type: "cc" } as never)).toBe(true);
        expect(isCc({ recipient_type: "signer" } as never)).toBe(false);
        expect(isCc({} as never)).toBe(false);
    });
});

describe("isEmptyRecipient", () => {
    // The predicate everything else filters on — if it is wrong, every function
    // above it is wrong too.
    it("treats blank and whitespace-only name+email as empty", () => {
        expect(isEmptyRecipient({ name: "", email: "" } as never)).toBe(true);
        expect(isEmptyRecipient({ name: "   ", email: "  " } as never)).toBe(true);
        expect(isEmptyRecipient({} as never)).toBe(true);
    });

    it("is not empty when either field has content", () => {
        expect(isEmptyRecipient({ name: "Ada", email: "" } as never)).toBe(false);
        expect(isEmptyRecipient({ name: "", email: "a@b.co" } as never)).toBe(false);
    });
});

describe("buildSignerRows", () => {
    it("drops empty recipients but keeps half-typed ones", () => {
        // A half-typed recipient IS stored — a draft that discarded the party
        // whose address the sender hadn't looked up yet would lose exactly the
        // work a draft exists to keep.
        const rows = build([
            { name: "", email: "", recipient_type: "signer" },
            { name: "Ada", email: "", recipient_type: "signer", role_id: "rol_a" },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.signer_name).toBe("Ada");
        expect(rows[0]!.signer_email).toBe("");
    });

    it("puts CC rows at CC_SIGNER_ORDER with no role", () => {
        const rows = build([{ name: "Obs", email: "obs@x.co", recipient_type: "cc" }]);
        expect(rows[0]!.signer_order).toBe(CC_SIGNER_ORDER);
        expect(CC_SIGNER_ORDER).toBe(0);
        expect(rows[0]!.role_id).toBeNull();
        expect(rows[0]!.recipient_type).toBe("cc");
    });

    it("takes each signer's order from its role", () => {
        const rows = build([
            { name: "A", email: "a@x.co", recipient_type: "signer", role_id: "rol_a" },
            { name: "C", email: "c@x.co", recipient_type: "signer", role_id: "rol_c" },
        ]);
        expect(rows.map((r) => r.signer_order)).toEqual([1, 2]);
    });

    it("falls back to order 1 for an unknown role", () => {
        const rows = build([
            { name: "X", email: "x@x.co", recipient_type: "signer", role_id: "rol_gone" },
        ]);
        expect(rows[0]!.signer_order).toBe(1);
    });

    it("lower-cases and trims the email, trims the name", () => {
        const rows = build([
            { name: "  Ada  ", email: "  ADA@X.CO ", recipient_type: "signer", role_id: "rol_a" },
        ]);
        expect(rows[0]!.signer_email).toBe("ada@x.co");
        expect(rows[0]!.signer_name).toBe("Ada");
    });

    it("stores a blank phone as null, not an empty string", () => {
        // An empty string in an audit payload reads as "recorded as blank" where
        // the truth is "the sender did not have it".
        const base = { name: "A", email: "a@x.co", recipient_type: "signer", role_id: "rol_a" };
        expect(build([{ ...base, phone: "   " }])[0]!.signer_phone).toBeNull();
        expect(build([{ ...base }])[0]!.signer_phone).toBeNull();
        expect(build([{ ...base, phone: " +61400 " }])[0]!.signer_phone).toBe("+61400");
    });

    it("never links signer_user_id, even for an email that could match an account", () => {
        // Linking an account that happens to share the email would silently
        // change who the audit trail names.
        const rows = build([
            { name: "A", email: "a@x.co", recipient_type: "signer", role_id: "rol_a" },
        ]);
        expect(rows[0]!.signer_user_id).toBeNull();
        expect(rows[0]!.status).toBe("pending");
    });
});

describe("firstSignerOrder", () => {
    it("ignores CCs sitting at order 0", () => {
        const rows = build([
            { name: "Obs", email: "o@x.co", recipient_type: "cc" },
            { name: "C", email: "c@x.co", recipient_type: "signer", role_id: "rol_c" },
        ]);
        // A naive min over every recipient would return 0, which
        // signature_requests_current_order_check (>= 1) rejects outright.
        expect(firstSignerOrder(rows)).toBe(2);
    });

    it("returns the shared order when two roles sign in parallel", () => {
        const rows = build([
            { name: "A", email: "a@x.co", recipient_type: "signer", role_id: "rol_a" },
            { name: "B", email: "b@x.co", recipient_type: "signer", role_id: "rol_b" },
        ]);
        expect(firstSignerOrder(rows)).toBe(1);
    });

    it("returns the placeholder 1 when a draft has no signers yet", () => {
        expect(firstSignerOrder([])).toBe(1);
        expect(
            firstSignerOrder(build([{ name: "O", email: "o@x.co", recipient_type: "cc" }]))
        ).toBe(1);
    });
});
