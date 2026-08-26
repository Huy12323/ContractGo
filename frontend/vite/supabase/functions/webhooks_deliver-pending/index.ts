/**
 * webhooks_deliver-pending — drains the delivery queue.
 *
 * SCHEDULED, every minute. `verify_jwt = false` (it arrives from
 * `net.http_post` inside Postgres, which carries no JWT), so `assertCronSecret`
 * is the whole of the authorization and `serveCronFunction` makes it the first
 * statement.
 *
 * ═══ THE CLAIM IS ONE CONDITIONAL UPDATE, NOT CHECK-THEN-WRITE ═══
 *
 * A minute-by-minute job whose previous tick has not finished is normal, not
 * exceptional: one slow consumer with a ten-second timeout can hold a run open
 * past the next fire. Selecting pending rows and then updating them would let
 * two overlapping ticks both claim the same delivery and both POST it — turning
 * a documented at-least-once guarantee into a routine duplicate.
 *
 * So the claim is a single `UPDATE … SET status='delivering' WHERE
 * status='pending' AND next_attempt_at <= now() … RETURNING`, the pattern
 * `signature_claim_turn` established: the WHERE clause asserts every
 * precondition at the moment of the write, so two callers racing cannot both
 * win. Delivery over the wire is still at-least-once — that is inherent to HTTP,
 * and why every payload carries `event_id` for the consumer to dedupe on.
 *
 * ═══ A CRASH MID-FLIGHT LEAVES A ROW IN `delivering`, AND THAT IS HANDLED ═══
 *
 * If the isolate dies between the claim and the result write, the row is stuck.
 * Rather than a separate reaper, each tick RECLAIMS `delivering` rows older than
 * `STALE_CLAIM_SECONDS` — comfortably longer than the request timeout, so a
 * genuinely in-flight delivery is never stolen from a live isolate.
 *
 * ═══ WHAT THIS FUNCTION DOES NOT DO ═══
 *
 * It never writes to `signature_audit_log`. Delivering a webhook is operational,
 * not evidentiary: the chain is the story of the AGREEMENT, and filling it with
 * "we told a third party about this" would drown the entries that matter — the
 * same argument `envelopes_document-url`'s header makes about viewing.
 */

import { jsonResponse } from "../_shared/http.ts";
import { getCronAdminClient, serveCronFunction } from "../_shared/cronAuth.ts";
import { createNotification } from "../_shared/notify.ts";
import {
    buildSignature,
    CIRCUIT_BREAKER_THRESHOLD,
    DELIVERY_ID_HEADER,
    EVENT_ID_HEADER,
    EVENT_TYPE_HEADER,
    isDeliverySuccess,
    nextAttempt,
    SIGNATURE_HEADER,
} from "../_shared/webhookSign.ts";

/**
 * One tick's worth. Bounded so a backlog cannot make a single invocation exceed
 * its wall clock — anything beyond this is picked up sixty seconds later, and
 * the count NOT taken is logged rather than silently dropped (v1.3's "no silent
 * caps" rule).
 */
const MAX_PER_RUN = 50;

/**
 * Per-request ceiling. A consumer that has not answered in ten seconds is
 * treated as down; waiting longer would let one slow endpoint consume the whole
 * tick and starve every other organization's queue.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Generous multiple of the timeout — a live isolate must never be robbed. */
const STALE_CLAIM_SECONDS = 300;

type Delivery = {
    id: string;
    endpoint_id: string;
    organization_id: string;
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    attempt_count: number;
};

type Endpoint = { id: string; url: string; secret: string; consecutive_failures: number };

serveCronFunction("webhooks_deliver-pending", async () => {
    const admin = getCronAdminClient();
    const startedAt = Date.now();

    // ---- 0. reclaim anything a dead isolate abandoned -------------------
    const staleBefore = new Date(Date.now() - STALE_CLAIM_SECONDS * 1000).toISOString();
    const { data: reclaimed, error: reclaimError } = await admin
        .from("webhook_deliveries")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("status", "delivering")
        .lt("updated_at", staleBefore)
        .select("id");

    if (reclaimError) {
        console.error("[cron:webhooks] reclaim failed:", reclaimError);
    } else if ((reclaimed?.length ?? 0) > 0) {
        console.warn(`[cron:webhooks] reclaimed ${reclaimed!.length} stale delivering row(s)`);
    }

    // ---- 1. claim -------------------------------------------------------
    // ONE conditional UPDATE. See the header: two overlapping ticks must not
    // both claim the same row.
    const { data: claimedRows, error: claimError } = await admin
        .from("webhook_deliveries")
        .update({ status: "delivering", updated_at: new Date().toISOString() })
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .select("id, endpoint_id, organization_id, event_id, event_type, payload, attempt_count")
        .limit(MAX_PER_RUN);

    if (claimError) {
        console.error("[cron:webhooks] claim failed:", claimError);
        return jsonResponse({ error: "Could not claim deliveries" }, 500);
    }

    const claimed = (claimedRows ?? []) as Delivery[];

    // How much was left behind, so a persistent backlog is visible rather than
    // inferred from deliveries arriving late.
    const { count: stillPending } = await admin
        .from("webhook_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString());

    if (claimed.length === 0) {
        // Emitted on EVERY tick including the empty ones — this line is the
        // proof-of-run surface, alongside `cron.job_run_details` and
        // `net._http_response`. A job that has silently stopped looks identical
        // to a job with nothing to do unless it says so.
        console.log("[cron:webhooks] claimed=0 delivered=0 failed=0 backlog=0");
        return jsonResponse({ claimed: 0, delivered: 0, failed: 0, backlog: 0 }, 200);
    }

    // ---- 2. resolve the endpoints ---------------------------------------
    const endpointIds = [...new Set(claimed.map((d) => d.endpoint_id))];
    const { data: endpointRows, error: endpointError } = await admin
        .from("webhook_endpoints")
        .select("id, url, secret, consecutive_failures")
        .in("id", endpointIds);

    if (endpointError) {
        console.error("[cron:webhooks] endpoint lookup failed:", endpointError);
        // Hand every claim back rather than leaving them in `delivering` for
        // five minutes: nothing was attempted, so nothing is in doubt.
        await admin
            .from("webhook_deliveries")
            .update({ status: "pending" })
            .in(
                "id",
                claimed.map((d) => d.id)
            );
        return jsonResponse({ error: "Could not load endpoints" }, 500);
    }

    const endpoints = new Map<string, Endpoint>(
        ((endpointRows ?? []) as Endpoint[]).map((e) => [e.id, e])
    );

    let delivered = 0;
    let failed = 0;

    // ---- 3. deliver ------------------------------------------------------
    // Sequential, deliberately. Parallel POSTs would finish the tick faster and
    // would also mean one organization with a large backlog opening fifty
    // sockets at once against endpoints that may all be the same host — which is
    // indistinguishable from an attack from the receiving end.
    for (const delivery of claimed) {
        const endpoint = endpoints.get(delivery.endpoint_id);

        if (!endpoint) {
            // The endpoint was deleted between the fan-out and now. The CASCADE
            // should have taken this row with it, so reaching here means the two
            // interleaved. Nothing to deliver to and nothing to retry.
            await admin
                .from("webhook_deliveries")
                .update({
                    status: "failed",
                    last_error: "Endpoint no longer exists",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", delivery.id);
            failed++;
            continue;
        }

        // Stringify ONCE. The signature must cover the exact bytes that go on
        // the wire — signing a re-serialization is how a signature comes to
        // describe a body that differs by a space.
        const body = JSON.stringify(delivery.payload);
        const timestampSeconds = Math.floor(Date.now() / 1000);

        let status: number | null = null;
        let errorText: string | null = null;

        try {
            const signature = await buildSignature({
                secret: endpoint.secret,
                body,
                timestampSeconds,
            });

            const response = await fetch(endpoint.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "ContractGo-Webhooks/1",
                    [SIGNATURE_HEADER]: signature,
                    [EVENT_ID_HEADER]: delivery.event_id,
                    [EVENT_TYPE_HEADER]: delivery.event_type,
                    [DELIVERY_ID_HEADER]: delivery.id,
                },
                body,
                // NEVER FOLLOW REDIRECTS. Following one would send a signed
                // payload describing a legal agreement to a host the endpoint's
                // owner never registered — an open redirect carrying our
                // signature. A 3xx is a failure, and `isDeliverySuccess` says so.
                redirect: "manual",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            status = response.status;
            if (!isDeliverySuccess(status)) {
                // Bounded: a consumer that answers a failure with a megabyte of
                // HTML must not put a megabyte of HTML in our database.
                errorText = (await response.text().catch(() => "")).slice(0, 500) || null;
            }
        } catch (err) {
            errorText = String((err as Error)?.message ?? err).slice(0, 500);
        }

        const ok = status !== null && isDeliverySuccess(status);
        const now = new Date().toISOString();
        const attempts = delivery.attempt_count + 1;

        if (ok) {
            await admin
                .from("webhook_deliveries")
                .update({
                    status: "delivered",
                    attempt_count: attempts,
                    last_status_code: status,
                    last_error: null,
                    delivered_at: now,
                    updated_at: now,
                })
                .eq("id", delivery.id);

            // Any success clears the breaker. A consumer that recovers should not
            // stay one failure away from being disabled.
            if (endpoint.consecutive_failures > 0) {
                await admin
                    .from("webhook_endpoints")
                    .update({ consecutive_failures: 0, updated_at: now })
                    .eq("id", endpoint.id);
                endpoint.consecutive_failures = 0;
            }
            delivered++;
            continue;
        }

        // ---- failure -----------------------------------------------------
        const next = nextAttempt(attempts);

        await admin
            .from("webhook_deliveries")
            .update({
                status: next.kind === "retry" ? "pending" : "failed",
                attempt_count: attempts,
                last_status_code: status,
                last_error: errorText ?? `HTTP ${status ?? "no response"}`,
                next_attempt_at:
                    next.kind === "retry"
                        ? new Date(Date.now() + next.delaySeconds * 1000).toISOString()
                        : now,
                updated_at: now,
            })
            .eq("id", delivery.id);

        failed++;

        const consecutive = endpoint.consecutive_failures + 1;
        endpoint.consecutive_failures = consecutive;

        if (consecutive < CIRCUIT_BREAKER_THRESHOLD) {
            await admin
                .from("webhook_endpoints")
                .update({ consecutive_failures: consecutive, updated_at: now })
                .eq("id", endpoint.id);
            continue;
        }

        // ---- circuit breaker ---------------------------------------------
        // Guarded on `is_enabled` so a concurrent tick cannot disable twice and
        // send two notifications for one outage.
        const { data: disabled } = await admin
            .from("webhook_endpoints")
            .update({
                is_enabled: false,
                consecutive_failures: consecutive,
                disabled_at: now,
                disabled_reason: `${consecutive} consecutive delivery failures. Last error: ${
                    errorText ?? `HTTP ${status}`
                }`,
                updated_at: now,
            })
            .eq("id", endpoint.id)
            .eq("is_enabled", true)
            .select("id");

        if ((disabled?.length ?? 0) > 0) {
            console.warn(
                `[cron:webhooks] endpoint ${endpoint.id} disabled after ${consecutive} failures`
            );
            // A SILENTLY DISABLED ENDPOINT IS HOW AN INTEGRATION DIES UNNOTICED.
            // Nobody is watching this job's log, and the fan-out will keep
            // skipping the endpoint from now on with no outward sign at all.
            await notifyOrgAdminsOfDisabledEndpoint(admin, {
                organizationId: delivery.organization_id,
                endpointId: endpoint.id,
                url: endpoint.url,
                reason: errorText ?? `HTTP ${status}`,
            });
        }
    }

    const backlog = Math.max((stillPending ?? 0) - claimed.length, 0);
    if (backlog > 0) {
        console.warn(`[cron:webhooks] ${backlog} delivery/deliveries left for the next tick`);
    }

    console.log(
        `[cron:webhooks] claimed=${claimed.length} delivered=${delivered} failed=${failed} ` +
            `backlog=${backlog} ms=${Date.now() - startedAt}`
    );

    return jsonResponse({ claimed: claimed.length, delivered, failed, backlog }, 200);
});

/**
 * Tells the organization's owner their integration has been switched off.
 *
 * Never throws — a notification failure must not turn a handled outage into a
 * 500, and the endpoint is already disabled by the time this runs. It follows
 * `_shared/notify.ts`'s own rule for the same reason that module states: the
 * notification is the least important thing happening in the request that
 * produces it.
 */
async function notifyOrgAdminsOfDisabledEndpoint(
    // deno-lint-ignore no-explicit-any
    admin: any,
    args: { organizationId: string; endpointId: string; url: string; reason: string }
): Promise<void> {
    try {
        const { data: org } = await admin
            .from("organizations")
            .select("owner_id")
            .eq("id", args.organizationId)
            .maybeSingle();

        // The OWNER, not "the admins". `notifyEnvelopeSender` reaches a document's
        // creator; an endpoint has no creator worth waking — `created_by_user_id`
        // is ON DELETE SET NULL and the person who wired the integration may have
        // left. The owner is the one account guaranteed to exist for as long as
        // the organization does, which is the property this notification needs.
        if (!org?.owner_id) return;

        await createNotification({
            admin,
            userId: org.owner_id as string,
            organizationId: args.organizationId,
            type: "webhook_endpoint_disabled",
            title: "A webhook endpoint was disabled",
            body: `${args.url} failed ${CIRCUIT_BREAKER_THRESHOLD} deliveries in a row and has been switched off. Last error: ${args.reason}`,
        });
    } catch (err) {
        console.error("[cron:webhooks] could not notify about the disabled endpoint:", err);
    }
}
