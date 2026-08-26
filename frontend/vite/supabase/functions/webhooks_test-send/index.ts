/**
 * webhooks_test-send — deliver a synthetic event to one endpoint, now, and
 * report exactly what came back.
 *
 * AUTHENTICATED (no `config.toml` block — that file enumerates only the
 * `verify_jwt = false` surfaces, and this one wants a JWT). `admin`, because
 * configuring integrations is organization administration and CG-044's scope
 * model deliberately puts that out of reach of an API key.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * Every other diagnostic in the webhook system is retrospective: the delivery
 * log says what happened to events that already occurred. An integrator wiring
 * up a new endpoint has no events yet, and their first real one will be a
 * signature on a live contract — a bad moment to discover the URL was wrong.
 * Without this, the only way to test an endpoint is to send a real document.
 *
 * It is also the only place the raw HTTP status and latency reach a human. The
 * pump records `last_status_code` on failure, but a 200 leaves no trace beyond
 * `delivered_at`, so "is my signature verification actually passing?" is not
 * answerable from the log.
 *
 * ═══ WHAT IT DOES NOT DO ═══
 *
 * It writes NO `webhook_deliveries` row and NO audit entry. A test is not an
 * event: putting it in the delivery log would mean the log no longer answers
 * "what did this organization's documents actually do", and every consumer would
 * have to learn to ignore a synthetic event id. The payload's `event` is
 * `webhook.test`, a value that is deliberately NOT in
 * `webhook_endpoints_events_enum` — a consumer switching on the enum will fall
 * through its default branch, which is the correct outcome for a ping.
 */

import { jsonResponse } from "../_shared/http.ts";
import { resolveSender, SenderAuthError, serveSenderFunction } from "../_shared/senderAuth.ts";
import {
    buildSignature,
    DELIVERY_ID_HEADER,
    EVENT_ID_HEADER,
    EVENT_TYPE_HEADER,
    isDeliverySuccess,
    SIGNATURE_HEADER,
} from "../_shared/webhookSign.ts";

/** Matches the pump, so a timeout here means a timeout there. */
const REQUEST_TIMEOUT_MS = 10_000;

serveSenderFunction("webhooks_test-send", async (body, req) => {
    const ctx = await resolveSender(req, String(body.organization_id ?? ""), "admin");
    const endpointId = String(body.endpoint_id ?? "");

    if (!endpointId) throw new SenderAuthError(400, "endpoint_id is required");

    // The organization filter is in the WHERE clause, so an endpoint id from
    // another organization is indistinguishable from a missing one.
    const { data: endpoint, error } = await ctx.admin
        .from("webhook_endpoints")
        .select("id, url, secret, is_enabled")
        .eq("id", endpointId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

    if (error) {
        console.error("webhooks_test-send: endpoint lookup failed:", error);
        throw new SenderAuthError(500, "Could not load the endpoint");
    }
    if (!endpoint) throw new SenderAuthError(404, "Endpoint not found");

    // A DISABLED endpoint is still testable, deliberately. The whole point of
    // pressing this is to find out whether it is safe to switch back on, and
    // refusing would leave the admin with no way to check other than re-enabling
    // it and waiting for a real document to be the experiment.
    const payload = {
        event: "webhook.test",
        event_id: `test_${crypto.randomUUID()}`,
        occurred_at: new Date().toISOString(),
        organization_id: ctx.organizationId,
        message: "This is a test delivery from ContractGo. No document is associated with it.",
    };

    const serialized = JSON.stringify(payload);
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signature = await buildSignature({
        secret: endpoint.secret as string,
        body: serialized,
        timestampSeconds,
    });

    const startedAt = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let errorText: string | null = null;

    try {
        const response = await fetch(endpoint.url as string, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "ContractGo-Webhooks/1",
                [SIGNATURE_HEADER]: signature,
                [EVENT_ID_HEADER]: payload.event_id,
                [EVENT_TYPE_HEADER]: "webhook.test",
                [DELIVERY_ID_HEADER]: payload.event_id,
            },
            body: serialized,
            // Same rule as the pump: a redirect is a failure, not an acceptance.
            // Testing with redirect-following would report success for a
            // configuration the pump will refuse.
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        status = response.status;
        responseBody = (await response.text().catch(() => "")).slice(0, 500) || null;
    } catch (err) {
        errorText = String((err as Error)?.message ?? err).slice(0, 500);
    }

    // 200 WHATEVER THE ENDPOINT SAID. The request to us succeeded; what the
    // endpoint answered is the RESULT, not an error. Returning 502 for a failed
    // test would make the UI render a system fault over a diagnostic that worked
    // perfectly and reported bad news — the same distinction v1.3.0 drew for
    // `verify_document`'s `verified: false`.
    return jsonResponse(
        {
            endpoint_id: endpoint.id,
            delivered: status !== null && isDeliverySuccess(status),
            status_code: status,
            latency_ms: Date.now() - startedAt,
            response_body: responseBody,
            error: errorText,
            // Echoed so an integrator debugging a signature mismatch can compare
            // against what their own code computed. The SECRET is never echoed.
            signature_header: signature,
            signed_payload_preview: `${timestampSeconds}.${serialized}`,
        },
        200
    );
});
