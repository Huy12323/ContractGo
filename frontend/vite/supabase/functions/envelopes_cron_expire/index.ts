/**
 * envelopes_cron_expire — close documents that ran out of time.
 *
 * SCHEDULED. `verify_jwt = false` (it is called by `net.http_post` from inside
 * Postgres, which carries no JWT), so `assertCronSecret` is the whole of the
 * authorization and `serveCronFunction` makes it the first statement — the same
 * position `resolveSignerToken` holds in the public signing functions.
 *
 * ORDER OF OPERATIONS PER REQUEST, and it is the opposite of `signing_decline`'s:
 *
 *   1. revoke every token   — this is the ONLY thing closing the door
 *   2. flip the status      — conditional, guarded on `in_progress`
 *   3. chain `request_expired`
 *   4. mail the sender
 *
 * Revocation goes FIRST here, matching `envelopes_void` rather than
 * `signing_decline`. In a decline the request's own `declined` status is what
 * makes `assertCanAct` refuse every path into signing, so revocation is defence
 * in depth. Here there is no such prior act: until one of these two writes
 * lands, a signer holding a live link can still sign a document that is past its
 * deadline. Revoking first means the worst case is a revoked link on a request
 * still marked in flight — recoverable by a resend — rather than a signature
 * accepted after expiry, which is not recoverable at all.
 *
 * Failures are PER REQUEST and non-fatal. One organization's unreadable profile
 * row must not stop every other expiry in the batch, and the job runs hourly, so
 * anything it misses is retried in an hour by construction.
 *
 * ⚠ DEVIATION from the plan's risk-3 mitigation ("both jobs log an audit entry
 * even when they find nothing to do"). They cannot: `signature_audit_log`
 * requires a NOT NULL `request_id` and its `seq` is per-request, so there is no
 * chain a "the job woke up" entry could belong to, and inventing a synthetic
 * request id to hold one would put a fabricated row in the evidence trail. The
 * proof-of-run surface is instead `cron.job_run_details` (did pg_cron fire),
 * `net._http_response` (did the POST reach anything) and this function's log
 * line, which is emitted on every tick including the empty ones.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getCronAdminClient, serveCronFunction } from "../_shared/cronAuth.ts";
import { logEnvelopeEvent, notifySenderOfExpiry } from "../_shared/envelopeNotify.ts";

/** One tick's worth of work. Anything beyond this waits for the next hour. */
const MAX_PER_RUN = 200;

serveCronFunction("envelopes_cron_expire", async () => {
    const admin = getCronAdminClient();
    const now = new Date().toISOString();

    const { data: due, error } = await admin
        .from("signature_requests")
        // `organizations(timezone)` embedded by CG-050 to render the expiry date
        // in the sender's own zone. Presentation only: the row's own pinned
        // `expires_at` is still what decides that it expired.
        .select("id, organization_id, title, created_by, expires_at, organizations(timezone)")
        .eq("status", "in_progress")
        .not("expires_at", "is", null)
        .lte("expires_at", now)
        // Oldest deadline first, so a backlog drains in the order it accrued
        // rather than leaving the most overdue documents until last.
        .order("expires_at", { ascending: true })
        .limit(MAX_PER_RUN);

    if (error) {
        console.error("envelopes_cron_expire: could not scan for due requests:", error);
        return jsonResponse({ error: "Scan failed" }, 500);
    }

    const expired: string[] = [];
    const skipped: string[] = [];

    for (const request of due ?? []) {
        // ---- 1. revoke ------------------------------------------------
        const { data: revoked, error: revokeError } = await admin.rpc(
            "signer_token_revoke_for_request",
            { p_request_id: request.id }
        );
        if (revokeError) {
            // Loud, and then on to the status flip anyway: a document whose
            // deadline has passed must stop being listed as in flight even if
            // one credential outlived it. The next tick will not retry this
            // request (its status has moved), so the log line is the record.
            console.error(`Revoking tokens for ${request.id} failed:`, revokeError);
        }

        // ---- 2. flip, conditionally -----------------------------------
        // PostgREST reports success for an UPDATE matching no rows, so without
        // the read-back an expiry racing a final signature would answer 200
        // having changed nothing. The guard is the same shape `signing_decline`
        // uses and for the same reason: only the write is atomic with respect to
        // a concurrent submit.
        const { data: flipped, error: flipError } = await admin
            .from("signature_requests")
            .update({ status: "expired" })
            .eq("id", request.id)
            .eq("status", "in_progress")
            .select("id")
            .maybeSingle();

        if (flipError) {
            console.error(`Expiring ${request.id} failed:`, flipError);
            continue;
        }
        if (!flipped) {
            // Completed, declined or voided between the scan and now. Not an
            // error — the route ended some other way, which is the better
            // outcome, and the tokens revoked above were going to be revoked by
            // whichever path did end it.
            skipped.push(request.id);
            continue;
        }

        // ---- 3. chain --------------------------------------------------
        // The actor is null: nobody did this. That is the distinguishing fact
        // between `request_expired` and `request_cancelled`, and it belongs in
        // the hashed payload rather than only in the event name.
        const { data: outstanding } = await admin
            .from("signature_request_signers")
            .select("signer_name, signer_email")
            .eq("request_id", request.id)
            .eq("recipient_type", "signer")
            .in("status", ["pending", "notified", "viewed"])
            .order("signer_order");

        await logEnvelopeEvent(admin, {
            requestId: request.id,
            organizationId: request.organization_id,
            signerId: null,
            actorUserId: null,
            // Nobody expired this document; the clock did. Named so the trail
            // says so rather than leaving the performer blank (CG-016).
            systemTask: "envelopes_cron_expire",
            eventType: "request_expired",
            payload: {
                expires_at: request.expires_at,
                expired_at: now,
                outstanding_signers: (outstanding ?? []).map((s) => s.signer_email),
            },
        });

        // The revoked count used to live in the payload above as
        // `tokens_revoked`, where it recorded NULL from CG-013 until CG-015
        // because `signer_token_revoke_for_request` returned VOID. Now that the
        // count exists it goes on its own entry instead, so that "were the links
        // killed, and how many" is answered by one event type across all four
        // causes — declined, cancelled, changes_requested, expired — rather than
        // by knowing which payload key each cause happened to use. Only when
        // non-zero, matching the other three.
        if (typeof revoked === "number" && revoked > 0) {
            await logEnvelopeEvent(admin, {
                requestId: request.id,
                organizationId: request.organization_id,
                signerId: null,
                actorUserId: null,
                // Nobody expired this document; the clock did. Named so the trail
                // says so rather than leaving the performer blank (CG-016).
                systemTask: "envelopes_cron_expire",
                eventType: "signer_token_revoked",
                payload: { revoked_count: revoked, cause: "expired" },
            });
        }

        // ---- 4. tell the sender ----------------------------------------
        const mailError = await notifySenderOfExpiry({
            admin,
            requestId: request.id,
            organizationId: request.organization_id,
            documentTitle: request.title,
            createdBy: request.created_by,
            expiredAt: now,
            outstanding: outstanding ?? [],
            organizationTimezone: (request.organizations as unknown as { timezone?: string } | null)
                ?.timezone,
        });
        if (mailError) {
            console.error(`Notifying the sender of ${request.id}'s expiry failed:`, mailError);
        }

        expired.push(request.id);
    }

    // Emitted on EVERY tick, including the empty ones — see the header note on
    // proof of run. `scanned` and `expired` differing is the interesting case:
    // it means requests ended some other way while the batch was in flight.
    console.log(
        `[cron:expire] scanned=${due?.length ?? 0} expired=${expired.length} skipped=${skipped.length}`
    );

    return jsonResponse({ ok: true, at: now, scanned: due?.length ?? 0, expired, skipped }, 200);
});
