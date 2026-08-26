/**
 * The email OTP driver — CG-031.
 *
 * `signing.ts` declared this seam and then threw for it: "OTP driver \"email\" is
 * not implemented yet. It lands in v1.2.0." This is v1.2.0's half of that
 * sentence, and it is the whole of what "sign straight from the email" needs on
 * the delivery side.
 *
 * A SEPARATE FILE, NOT A BRANCH IN `signing.mock.ts`, for the reason `signing.ts`
 * states above `getSignatureDriver`: the driver modules are dynamically imported
 * so the mock path never pulls node-forge into a function that only wanted to
 * send an email. Putting this next to the mock would undo that for every caller.
 *
 * IT SENDS; IT DOES NOT DECIDE. The contract in `signing.ts` is deliberately
 * narrow — "Sends a code the CALLER generated. The driver never mints or stores
 * one: the hash and the attempt counter belong to the database." So there is no
 * generation, no persistence, no retry and no rate limiting here. All four live
 * in `signer_otp_issue`, where they are one statement and cannot be raced. A
 * driver that quietly re-sent on failure would be a driver that defeats the
 * cooldown.
 *
 * WHY IT GOES THROUGH `shared--send-email` RATHER THAN CALLING RESEND. That
 * function owns the allowlist that keeps dev mail out of strangers' inboxes, the
 * `console` driver that makes a Cloudflare-free local run possible, and the
 * template shell. A second path to the mail provider would be a second place for
 * all three to drift — and the first time it drifted, the symptom would be a
 * passcode delivered to a real address from someone's laptop.
 */

import { requireEnv } from "./http.ts";
import type { OtpDriver } from "./signing.ts";

export function createEmailOtpDriver(): OtpDriver {
    return {
        name: "email",
        async send({
            destination,
            code,
            documentTitle,
            signerName,
            organizationName,
            expiresInMinutes,
        }) {
            const supabaseUrl = requireEnv("SUPABASE_URL");
            const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

            const response = await fetch(`${supabaseUrl}/functions/v1/shared--send-email`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${serviceRoleKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    scenario: "signature_request_passcode",
                    to: destination,
                    // Every field `signature_request_passcode` lists as required.
                    // `interpolate` renders an absent placeholder as "", so a
                    // missing one is not an error — it is a sentence with a hole
                    // in it, which on a passcode email reads as a forgery.
                    payload: {
                        code,
                        documentTitle,
                        signerName,
                        orgName: organizationName,
                        expiresInMinutes: String(expiresInMinutes),
                    },
                    // NO `notify` HINTS, and this is the important line in the
                    // file. `shared--send-email` mirrors anything it is given
                    // hints for into a `notifications` row (CG-018), and a
                    // notification row is readable, durable and rendered — three
                    // things a live passcode must never be. `_shared/notify.ts`
                    // independently refuses this scenario via NOT_MIRRORED; this
                    // is the first of those two gates, not the only one.
                }),
            });

            if (!response.ok) {
                // Surfaced, never swallowed. The caller has already recorded a
                // challenge in the database, so a silent failure here would leave
                // a signer staring at a code entry box waiting for mail that is
                // never coming, with the cooldown blocking their retry.
                const detail = await response.text().catch(() => "");
                throw new Error(
                    `Passcode email failed (${response.status}): ${detail.slice(0, 200)}`
                );
            }
        },
    };
}
