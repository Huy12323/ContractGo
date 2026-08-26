import { describe, expect, it } from "vitest";
import { sessionProvedMailbox } from "../../../supabase/functions/_shared/auditEvidence.ts";

/**
 * CG-031. `sessionProvedMailbox` is the one place where a claim out of a JWT
 * decides whether somebody may sign — `assertSignerAccount` accepts it as an
 * alternative to `profiles.email_verified`, so a bug here is a bug that lets the
 * wrong person sign a contract.
 *
 * Which makes the interesting cases the NEGATIVE ones. Anything unrecognised,
 * absent or malformed must be false, because the caller reads false as "fall
 * back to the column" and true as "this mailbox was proved".
 */

const session = (amr: unknown) => ({ aal: "aal1", amr });

describe("sessionProvedMailbox — accepts", () => {
    it("GoTrue's object form for an emailed code or magic link", () => {
        expect(sessionProvedMailbox(session([{ method: "otp", timestamp: 1 }]))).toBe(true);
    });

    it("older bare-string spellings", () => {
        expect(sessionProvedMailbox(session(["magiclink"]))).toBe(true);
        expect(sessionProvedMailbox(session(["email"]))).toBe(true);
    });

    it("a mailbox method sitting alongside others", () => {
        // MFA and step-up flows list more than one. Finding the proof anywhere in
        // the list is the point — requiring it to be the only entry would refuse
        // a signer who did MORE than the minimum.
        expect(sessionProvedMailbox(session([{ method: "password" }, { method: "otp" }]))).toBe(
            true
        );
    });
});

describe("sessionProvedMailbox — refuses", () => {
    it("a password or OAuth session", () => {
        // Neither says anything about the mailbox: a password is something they
        // knew, and an OAuth identity was proved to a different provider. Both
        // still reach `profiles.email_verified`, which is the correct route for
        // them.
        expect(sessionProvedMailbox(session([{ method: "password" }]))).toBe(false);
        expect(sessionProvedMailbox(session([{ method: "oauth" }]))).toBe(false);
    });

    it("a missing, null or non-array amr", () => {
        expect(sessionProvedMailbox(null)).toBe(false);
        expect(sessionProvedMailbox(session(undefined))).toBe(false);
        expect(sessionProvedMailbox(session("otp"))).toBe(false);
        expect(sessionProvedMailbox(session({ method: "otp" }))).toBe(false);
    });

    it("entries whose method is not a string", () => {
        // Fails closed on shapes nobody anticipated rather than throwing. A
        // decode that surprises us must deny, not 500 — and certainly not allow.
        expect(sessionProvedMailbox(session([{ method: 42 }]))).toBe(false);
        expect(sessionProvedMailbox(session([null]))).toBe(false);
        expect(sessionProvedMailbox(session([{}]))).toBe(false);
    });

    it("an empty list", () => {
        expect(sessionProvedMailbox(session([]))).toBe(false);
    });
});
