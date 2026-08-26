import { afterEach, describe, expect, it } from "vitest";
import { createMockIdentityDriver } from "../../../supabase/functions/_shared/signing.identity.mock.ts";

/**
 * [ekyc] CG-033. Pure — no SupabaseClient — so it belongs in the unit silo under
 * the `docs/testing.md` rule.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. `startSession` originally returned
 * `mock_kyc_${signerId}`, a value CONSTANT PER SIGNER, while
 * `signer_identity_checks.provider_session_id` carries a UNIQUE index and a
 * superseded check is marked rejected rather than deleted — so the first row's
 * handle lives forever. The result was that a signer could start exactly ONE
 * identity check in their lifetime; every later attempt died on a unique
 * violation surfacing as a 500, including the retry a rejection is supposed to
 * offer. It reproduced only on the second call, which is why the Phase A
 * one-shot driver probe and every scripted smoke missed it and a browser found
 * it.
 *
 * So the assertion that matters is about the SECOND call, not the first — a
 * shape test on one return value would have passed against the bug.
 */

const SIGNER = "sgs_r8trGi6gO6OBjY3V";
const REDIRECT = "http://localhost:5173/sign/identity-return";

const start = (signerId = SIGNER) =>
    createMockIdentityDriver().startSession({ signerId, redirectUrl: REDIRECT });

describe("createMockIdentityDriver — startSession", () => {
    it("mints a DIFFERENT providerSessionId on every call for the SAME signer", async () => {
        const [a, b] = [await start(), await start()];

        expect(a.providerSessionId).not.toBe(b.providerSessionId);
    });

    it("stays unique across many calls — the throttle caps attempts, not the index", async () => {
        const ids = await Promise.all(Array.from({ length: 25 }, () => start()));

        expect(new Set(ids.map((s) => s.providerSessionId)).size).toBe(25);
    });

    it("keeps the signer id in the prefix so a row greps back to its signer", async () => {
        expect((await start()).providerSessionId).toMatch(
            new RegExp(`^mock_kyc_${SIGNER}_[0-9a-f]{12}$`)
        );
    });

    it("never collides across signers either", async () => {
        const [a, b] = [await start("sgs_aaaaaaaaaaaaaaaa"), await start("sgs_bbbbbbbbbbbbbbbb")];

        expect(a.providerSessionId).not.toBe(b.providerSessionId);
    });

    it("returns the caller's redirectUrl unchanged — the server built it, the driver does not", async () => {
        // The URL is built server-side and never taken from the body
        // (`signing_identity_start`'s header: a body-supplied redirect on a
        // `verify_jwt = false` endpoint is an open redirect). A mock that
        // rewrote it would hide a real driver doing the same.
        expect((await start()).redirectUrl).toBe(REDIRECT);
    });
});

/**
 * `IDENTITY_MOCK_VERDICT` is read per call, and ANYTHING unrecognised —
 * including unset — must be `approved`, byte-identical to the behaviour before
 * the reject path existed. That additive-safety claim was verified once by a
 * one-off Deno script in Phase A; this pins it.
 */
describe("createMockIdentityDriver — getVerdict", () => {
    afterEach(() => {
        delete process.env.IDENTITY_MOCK_VERDICT;
    });

    const verdict = () => createMockIdentityDriver().getVerdict("mock_kyc_whatever");

    it("approves when IDENTITY_MOCK_VERDICT is unset", async () => {
        expect(await verdict()).toEqual({ status: "approved", score: 1 });
    });

    it("approves on an UNRECOGNISED value rather than failing open into rejection", async () => {
        process.env.IDENTITY_MOCK_VERDICT = "banana";

        expect(await verdict()).toEqual({ status: "approved", score: 1 });
    });

    it("rejects with a reason, and the reason names the trigger", async () => {
        process.env.IDENTITY_MOCK_VERDICT = "rejected";
        const result = await verdict();

        expect(result.status).toBe("rejected");
        expect(result.score).toBe(0);
        expect(result.rejectionReason).toContain("IDENTITY_MOCK_VERDICT");
    });

    it("returns pending with NO score — a poll is not a verdict", async () => {
        process.env.IDENTITY_MOCK_VERDICT = "pending";

        expect(await verdict()).toEqual({ status: "pending" });
    });

    it("is case- and whitespace-insensitive on the trigger", async () => {
        process.env.IDENTITY_MOCK_VERDICT = "  ReJeCtEd  ";

        expect((await verdict()).status).toBe("rejected");
    });
});
