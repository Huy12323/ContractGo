/**
 * [ekyc] Mock implementation of the IDENTITY driver, alone in its own module.
 *
 * SPLIT OUT OF `signing.mock.ts` DELIBERATELY, for two reasons that point the
 * same way:
 *
 *   1. IT SHARES NOTHING WITH THE OTHER THREE MOCKS. They exist to produce PDF
 *      bytes, and so they pull in node-forge, @signpdf/* and pdf-lib. An
 *      identity verdict is a string and a number. Reaching this function through
 *      that module meant dragging the whole certificate-and-PDF stack behind it
 *      — which is what kept it out of the unit silo, since `docs/testing.md`
 *      rightly refuses to alias five edge-only specifiers to get at one pure
 *      function.
 *   2. REMOVABILITY (plan decision 7). eKYC is meant to be safely removable. In
 *      `signing.mock.ts` this code was an entry on the removal recipe's "revert
 *      lines inside a working file" list, which is the list where mistakes
 *      happen. Here it is an `rm`.
 *
 * Loaded through a lazy `import()` in `signing.ts`, the same way its siblings
 * are, so nothing pays for it at module scope.
 */

import type { IdentityDriver } from "./signing.ts";

/**
 * What `getVerdict` should answer, read from `IDENTITY_MOCK_VERDICT`.
 *
 * DELIBERATELY EXPLICIT, NOT RANDOM AND NOT DATA-DRIVEN. The original comment's
 * objection to a dice roll — "is the flow broken, or did the dice say no?" —
 * applies to any implicit trigger, including magic email addresses. An
 * environment variable is greppable, is set by the person exercising the path,
 * and cannot fire on real data.
 *
 * ANYTHING ELSE, INCLUDING UNSET, IS `approved` — byte-identical to the
 * behaviour before the reject path existed.
 */
function mockVerdict(): "approved" | "rejected" | "pending" {
    const raw = Deno.env.get("IDENTITY_MOCK_VERDICT")?.trim().toLowerCase();
    return raw === "rejected" || raw === "pending" ? raw : "approved";
}

export function createMockIdentityDriver(): IdentityDriver {
    return {
        name: "mock",
        async startSession({ signerId, redirectUrl }) {
            // FRESH PER CALL, never `mock_kyc_${signerId}` alone.
            // `provider_session_id` carries a UNIQUE index, and a superseded
            // check is marked rejected rather than deleted (CG-033) — so its
            // handle lives forever. A per-signer constant therefore let a signer
            // start exactly ONE check in their lifetime and 500'd on every
            // retry, including the retry a rejection is supposed to offer.
            // A real vendor mints a new handle per session; the mock owes the
            // same contract, and owing it is what keeps the unique index a
            // check on OUR bookkeeping rather than a cap on attempts.
            // The signer id stays in the prefix purely so a row is greppable
            // back to its signer in local debugging.
            const suffix = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
            return await Promise.resolve({
                providerSessionId: `mock_kyc_${signerId}_${suffix}`,
                redirectUrl,
            });
        },
        async getVerdict() {
            const status = mockVerdict();
            if (status === "rejected") {
                return await Promise.resolve({
                    status,
                    score: 0,
                    rejectionReason: "Simulated rejection (IDENTITY_MOCK_VERDICT=rejected)",
                });
            }
            if (status === "pending") return await Promise.resolve({ status });
            return await Promise.resolve({ status, score: 1 });
        },
    };
}
