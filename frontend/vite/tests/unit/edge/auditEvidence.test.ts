import { describe, expect, it } from "vitest";
import {
    readSessionClaims,
    recipientActor,
    recipientSnapshot,
    signatureMethodOf,
} from "../../../supabase/functions/_shared/auditEvidence.ts";

/**
 * The shapes that go into the hash-chained audit log.
 *
 * These helpers exist BECAUSE three writers previously disagreed about actor
 * shape. Nothing but a test stops them diverging again — and once an entry is
 * chained, a wrong shape is permanent.
 */

const SIGNER = {
    id: "sgn_1",
    signer_name: "Ada Lovelace",
    signer_email: "ada@example.com",
    signer_phone: "+61400000000",
    recipient_type: "signer" as const,
};

describe("recipientActor", () => {
    it("records the point-in-time snapshot the sender addressed", () => {
        expect(recipientActor(SIGNER)).toEqual({
            kind: "signer",
            user_id: null,
            signer_id: "sgn_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+61400000000",
        });
    });

    it("marks a cc as an observer", () => {
        expect(recipientActor({ ...SIGNER, recipient_type: "cc" }).kind).toBe("observer");
    });

    it("treats a null/absent recipient_type as a signer", () => {
        expect(recipientActor({ ...SIGNER, recipient_type: null }).kind).toBe("signer");
    });

    it("ADDS user_id without replacing the row's identity", () => {
        // The row says who the sender addressed; the account says who turned up.
        // An entry showing only the second would lose the first.
        const actor = recipientActor(SIGNER, "usr_9");
        expect(actor.user_id).toBe("usr_9");
        expect(actor.email).toBe("ada@example.com");
        expect(actor.signer_id).toBe("sgn_1");
    });

    it("normalises missing fields to null, never undefined", () => {
        const actor = recipientActor({ id: "sgn_2", signer_name: null, signer_email: null });
        expect(actor.name).toBeNull();
        expect(actor.email).toBeNull();
        expect(actor.phone).toBeNull();
    });
});

describe("recipientSnapshot", () => {
    it("captures only identity, never the actor kind or id", () => {
        // Kept separate from actor on purpose: conflating them would make the
        // trail claim the recipient performed the act done TO them.
        expect(recipientSnapshot(SIGNER)).toEqual({
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+61400000000",
        });
    });

    it("normalises absent fields to null", () => {
        expect(recipientSnapshot({})).toEqual({ name: null, email: null, phone: null });
    });
});

describe("signatureMethodOf", () => {
    it("maps every known capture method", () => {
        expect(signatureMethodOf("drawn")).toBe("drawn_signature");
        expect(signatureMethodOf("typed")).toBe("typed_signature");
        expect(signatureMethodOf("uploaded")).toBe("uploaded_signature");
    });

    it("returns null for null and for anything unrecognised", () => {
        expect(signatureMethodOf(null)).toBeNull();
        expect(signatureMethodOf("scribbled")).toBeNull();
        expect(signatureMethodOf("")).toBeNull();
    });
});

describe("readSessionClaims", () => {
    const encode = (payload: unknown) =>
        `Bearer header.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_")}.sig`;

    it("decodes aal and amr from an already-verified token", () => {
        const header = encode({ aal: "aal1", amr: [{ method: "password" }] });
        expect(readSessionClaims(header)).toEqual({
            aal: "aal1",
            amr: [{ method: "password" }],
        });
    });

    it("tolerates a missing Bearer prefix", () => {
        const raw = encode({ aal: "aal2", amr: null }).replace(/^Bearer\s+/, "");
        expect(readSessionClaims(raw)?.aal).toBe("aal2");
    });

    it("returns null for a null header", () => {
        expect(readSessionClaims(null)).toBeNull();
    });

    it("returns nulls rather than throwing on malformed input", () => {
        // Nothing is AUTHORIZED on these claims — they are read only to be
        // recorded — so the worst case of a malformed token must be a null in
        // the payload, never a 500 that loses the audit entry.
        expect(readSessionClaims("Bearer garbage")).toBeNull();
        expect(readSessionClaims("Bearer a.!!!notbase64!!!.c")).toBeNull();
        expect(readSessionClaims(`Bearer a.${btoa("not json")}.c`)).toBeNull();
    });

    it("coerces a non-string aal to null", () => {
        expect(readSessionClaims(encode({ aal: 1, amr: [] }))).toEqual({ aal: null, amr: [] });
    });
});
