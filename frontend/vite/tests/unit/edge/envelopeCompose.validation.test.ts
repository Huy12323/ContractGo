import { describe, expect, it } from "vitest";
import {
    validateForDraft,
    validateForSend,
} from "../../../supabase/functions/_shared/envelopeCompose.ts";

/**
 * The two validation strictnesses. A draft is a saved intent and must stay
 * permissive; a send is the legally consequential moment and must not be.
 * Every rule here exists because of a way an envelope can be silently useless.
 */

const ROLES = [
    { id: "rol_sender", name: "Sender", order: 0 },
    { id: "rol_a", name: "Party A", order: 1 },
    { id: "rol_b", name: "Party B", order: 1 },
] as never as Parameters<typeof validateForSend>[0]["signerRoles"];

const signer = (over: Record<string, unknown> = {}) => ({
    name: "Ada",
    email: "ada@example.com",
    recipient_type: "signer",
    role_id: "rol_a",
    ...over,
});

const send = (over: Record<string, unknown> = {}, layout: unknown[] = []) =>
    validateForSend({
        body: {
            title: "Contract",
            organization_id: "org_1",
            recipients: [signer()],
            ...over,
        } as never,
        layout: layout as never,
        signerRoles: ROLES,
    });

describe("validateForDraft", () => {
    it("requires organization_id and template_id", () => {
        expect(validateForDraft({} as never)).toBe("organization_id is required");
        // source_pdf_sha256 is NOT NULL, so a draft with no template has no bytes
        // to hash and cannot exist as a row.
        expect(validateForDraft({ organization_id: "org_1" } as never)).toBe(
            "Pick a document before saving a draft"
        );
    });

    it("stays silent about the things only a send insists on", () => {
        const ok = validateForDraft({
            organization_id: "org_1",
            template_id: "tpl_1",
            recipients: [signer({ name: "", email: "" }), signer({ email: "" })],
        } as never);
        expect(ok).toBeNull();
    });

    it("refuses shape violations at both strictnesses", () => {
        // A cc carrying a role would otherwise fail the CG-011 shape CHECK with a
        // constraint name instead of a sentence.
        const base = { organization_id: "org_1", template_id: "tpl_1" };
        expect(
            validateForDraft({
                ...base,
                recipients: [signer({ recipient_type: "cc", role_id: "rol_a" })],
            } as never)
        ).toBe("A copied recipient cannot be assigned a role");

        expect(
            validateForDraft({ ...base, recipients: [signer({ role_id: undefined })] } as never)
        ).toBe("Every signer must be assigned a role");
    });
});

describe("validateForSend", () => {
    it("passes a well-formed envelope", () => {
        expect(send()).toBeNull();
    });

    it("requires a title", () => {
        expect(send({ title: "   " })?.error).toBe("A document title is required");
    });

    it("requires at least one non-empty recipient", () => {
        expect(send({ recipients: [] })?.error).toBe("At least one recipient is required");
        expect(send({ recipients: [{ name: "", email: "" }] })?.error).toBe(
            "At least one recipient is required"
        );
    });

    it("requires a name on every recipient", () => {
        expect(send({ recipients: [signer({ name: "  " })] })?.error).toBe(
            "Every recipient needs a name"
        );
    });

    it("rejects malformed emails", () => {
        for (const bad of ["ada", "ada@", "@example.com", "ada @example.com", "ada@example"]) {
            expect(send({ recipients: [signer({ email: bad })] })?.error).toMatch(
                /is not a valid email address/
            );
        }
    });

    it("rejects a CC carrying a role and a signer missing one", () => {
        expect(
            send({ recipients: [signer({ recipient_type: "cc", role_id: "rol_a" })] })?.error
        ).toBe("A copied recipient cannot be assigned a role");
        expect(send({ recipients: [signer({ role_id: undefined })] })?.error).toBe(
            "Every signer must be assigned a role"
        );
    });

    it("rejects an all-CC recipient set", () => {
        // The one recipient rule about the SET rather than a row: current_order
        // would have no order to take and nobody could ever sign.
        const result = send({
            recipients: [
                signer({ recipient_type: "cc", role_id: undefined }),
                signer({ recipient_type: "cc", role_id: undefined, email: "b@example.com" }),
            ],
        });
        expect(result?.error).toBe(
            "At least one signer is required — copied recipients cannot sign"
        );
    });

    it("reports an unknown role_id as a stale-template error", () => {
        const result = send({ recipients: [signer({ role_id: "rol_deleted" })] });
        expect(result?.error).toMatch(/template changed while you were composing/);
        expect(result?.unknown_role_id).toBe("rol_deleted");
    });

    it("refuses to assign a recipient to the sender role", () => {
        expect(send({ recipients: [signer({ role_id: "rol_sender" })] })?.error).toMatch(
            /sender role is filled by you/
        );
    });

    it("refuses two recipients on one role", () => {
        // CG-011 made this a UNIQUE (request_id, role_id) invariant: two people on
        // one role would sign into the same rectangle.
        const result = send({
            recipients: [signer(), signer({ email: "b@example.com", name: "Bob" })],
        });
        expect(result?.error).toBe("Each role can have only one recipient.");
    });

    it("allows two roles that share an order — that is parallel signing, not a clash", () => {
        expect(
            send({
                recipients: [signer(), signer({ role_id: "rol_b", email: "b@example.com" })],
            })
        ).toBeNull();
    });

    it("reports roles that have fields but no recipient", () => {
        const layout = [{ id: "f1", label: "Sig B", type: "signature", role_id: "rol_b" }];
        const result = send({}, layout);
        expect(result?.error).toMatch(/These roles have fields but no recipient/);
        expect(result?.uncovered_roles).toEqual(["Party B"]);
    });

    it("refuses signature fields on the sender role", () => {
        // The sender never opens the signing surface, so such a box can never be filled.
        const layout = [{ id: "f1", label: "My Sig", type: "signature", role_id: "rol_sender" }];
        expect(send({}, layout)?.error).toMatch(/sender role carries signature fields/);
    });

    it("requires sender-role required fields to be prefilled", () => {
        const layout = [
            { id: "f1", label: "Company", type: "text", role_id: "rol_sender", required: true },
        ];
        const missing = send({}, layout);
        expect(missing?.error).toBe("Fill your own required fields before sending.");
        expect(missing?.missing_fields).toEqual([{ id: "f1", label: "Company" }]);

        expect(send({ prefilled_values: { f1: "Acme" } }, layout)).toBeNull();
        // false and "" are treated as unfilled, not as values.
        expect(send({ prefilled_values: { f1: "" } }, layout)?.missing_fields).toHaveLength(1);
        expect(send({ prefilled_values: { f1: false } }, layout)?.missing_fields).toHaveLength(1);
    });
});
