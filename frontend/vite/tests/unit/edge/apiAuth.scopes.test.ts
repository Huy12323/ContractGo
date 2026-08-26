import { describe, expect, it } from "vitest";
import {
    type ApiScope,
    canonicalJson,
    satisfiesScope,
} from "../../../supabase/functions/_shared/apiAuth.ts";

/**
 * CG-044's two pure decisions.
 *
 * `satisfiesScope` is the whole of what an API key may do — it is called once
 * per request and nothing downstream re-checks it, so a wrong answer here is a
 * machine sending contracts it was never granted permission to send.
 *
 * `canonicalJson` decides whether a retry is "the same request". Too strict and
 * every retry is a 409 for a client that merely reordered its JSON keys; too
 * loose and two genuinely different documents share an idempotency key, so the
 * second is answered with the first one's response and never sent at all.
 */

const ALL: ApiScope[] = ["member", "send_documents", "manage_templates"];

describe("satisfiesScope", () => {
    it("treats any scope at all as membership", () => {
        for (const scope of ALL) {
            expect(satisfiesScope([scope], "member")).toBe(true);
        }
    });

    it("refuses a key with no scopes, even for the read tier", () => {
        // The empty array is unrepresentable in the database — CG-044's CHECK
        // forbids it, and the COALESCE in that CHECK is what makes the forbidding
        // actually happen (array_length of an empty array is NULL, and a CHECK
        // evaluating to NULL PASSES). This asserts the belt to that braces: even
        // if a row like this existed, it would authorize nothing.
        expect(satisfiesScope([], "member")).toBe(false);
        expect(satisfiesScope([], "send_documents")).toBe(false);
        expect(satisfiesScope([], "manage_templates")).toBe(false);
    });

    it("does not let one write scope imply the other", () => {
        // The bug this exists to prevent: a key granted send_documents quietly
        // acquiring the ability to rewrite the templates it sends from.
        expect(satisfiesScope(["send_documents"], "manage_templates")).toBe(false);
        expect(satisfiesScope(["manage_templates"], "send_documents")).toBe(false);
    });

    it("grants each write scope to itself", () => {
        expect(satisfiesScope(["send_documents"], "send_documents")).toBe(true);
        expect(satisfiesScope(["manage_templates"], "manage_templates")).toBe(true);
    });

    it("NEVER grants admin, whatever the key holds", () => {
        // Organization administration is not a machine action. The scope is
        // absent from `api_keys_scopes_enum`, so no key can carry it — this
        // asserts the TypeScript half refuses too, rather than falling through a
        // switch with no matching case.
        expect(satisfiesScope(ALL, "admin")).toBe(false);
        expect(satisfiesScope(["manage_templates"], "admin")).toBe(false);
        expect(satisfiesScope([], "admin")).toBe(false);
    });
});

describe("canonicalJson", () => {
    it("is insensitive to object key order", () => {
        expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    });

    it("sorts keys recursively, not just at the top level", () => {
        const one = { outer: { z: 1, a: { y: 2, b: 3 } } };
        const two = { outer: { a: { b: 3, y: 2 }, z: 1 } };
        expect(canonicalJson(one)).toBe(canonicalJson(two));
    });

    it("PRESERVES array order, because order is meaning", () => {
        // `recipients` order is the signing sequence. Two sends whose recipient
        // lists differ only in order are different sends, and collapsing them
        // would let the second silently replay the first.
        const ab = canonicalJson({ recipients: [{ email: "a@x.test" }, { email: "b@x.test" }] });
        const ba = canonicalJson({ recipients: [{ email: "b@x.test" }, { email: "a@x.test" }] });
        expect(ab).not.toBe(ba);
    });

    it("distinguishes a changed value", () => {
        expect(canonicalJson({ title: "Offer" })).not.toBe(canonicalJson({ title: "offer" }));
    });

    it("distinguishes an added key from an absent one", () => {
        expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 1, b: null }));
    });

    it("survives nulls and nested arrays of objects without throwing", () => {
        expect(() =>
            canonicalJson({ a: null, b: [{ c: [1, 2, { d: null }] }], e: undefined })
        ).not.toThrow();
    });
});
