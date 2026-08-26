/**
 * Webhook signing and the retry ladder — the two decisions in the delivery pump
 * that are pure, and therefore the two that are testable.
 *
 * THIS MODULE IMPORTS NOTHING. That is deliberate and load-bearing:
 * `docs/testing.md`'s non-negotiable rule is that only pure functions may be
 * imported from `_shared` into a unit test, and these functions are what
 * `docs/api.md`'s copy-pasteable verification snippets are asserted against. A
 * signed webhook nobody can verify is an unsigned webhook, so the documented
 * example and the implementation must be provably the same thing.
 */

// ============================================================
// The signature
// ============================================================

/**
 * The Stripe scheme, and the choice is about the ecosystem rather than the
 * cryptography: `t=<unix>,v1=<hex>` is the format integrators already have
 * library code and muscle memory for, and every hour spent on a bespoke header
 * is an hour a customer spends failing to verify it.
 *
 * THE TIMESTAMP IS INSIDE THE SIGNED STRING, not merely beside it. Signing the
 * body alone would produce a header that is valid forever: anyone who captured
 * one request could replay it at any later time and the signature would still
 * check out. Binding `t` to the body means a replay can only be accepted if the
 * consumer also chooses to accept a stale `t` — which is a decision they can
 * make and we can document, rather than a hole they cannot close.
 *
 * `v1` is a version prefix, not decoration. A future scheme ships as `v2=` in
 * the same header, so a consumer that checks `v1` keeps working while one that
 * has upgraded can require `v2` — the migration path exists before it is needed.
 */
export const SIGNATURE_HEADER = "X-ContractGo-Signature";
export const EVENT_ID_HEADER = "X-ContractGo-Event-Id";
export const DELIVERY_ID_HEADER = "X-ContractGo-Delivery-Id";
export const EVENT_TYPE_HEADER = "X-ContractGo-Event";

/** The exact bytes that get signed. Documented so a consumer can reproduce it. */
export function signedPayload(timestampSeconds: number, body: string): string {
    return `${timestampSeconds}.${body}`;
}

function toHex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * `t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`
 *
 * `body` is the EXACT string that will be sent, not an object — re-serializing
 * an object to sign it and then serializing it again to send it is how a
 * signature comes to cover bytes that differ from the bytes on the wire by a
 * space. The caller stringifies once and passes the result to both.
 */
export async function buildSignature(args: {
    secret: string;
    body: string;
    timestampSeconds: number;
}): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(args.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(signedPayload(args.timestampSeconds, args.body))
    );

    return `t=${args.timestampSeconds},v1=${toHex(mac)}`;
}

// ============================================================
// The retry ladder
// ============================================================

/**
 * `1m / 5m / 30m / 2h / 12h / 24h`, then give up.
 *
 * Six rungs spanning a little under two days. The shape matters more than the
 * numbers: the first two are close together because most failures are a deploy
 * or a restart and resolve in minutes, and the last two are far apart because a
 * consumer that has been down for hours is not coming back inside the next
 * retry — continuing to hammer them amplifies someone else's outage into ours.
 */
export const RETRY_LADDER_SECONDS = [60, 300, 1800, 7200, 43200, 86400] as const;

/** How many consecutive failures disable an endpoint entirely. */
export const CIRCUIT_BREAKER_THRESHOLD = 10;

export type NextAttempt =
    | { kind: "retry"; delaySeconds: number; attempt: number }
    | { kind: "exhausted"; attempts: number };

/**
 * Given how many attempts have already been made, when (if ever) to try again.
 *
 * `attemptCount` is the number ALREADY made, so the first failure arrives here
 * as 1 and takes the first rung. Off-by-one in either direction is invisible in
 * review and shows up as either a doubled first retry or a silently skipped
 * final one, which is why this is a named function with a test rather than an
 * index into an array at the call site.
 */
export function nextAttempt(attemptCount: number): NextAttempt {
    const index = attemptCount - 1;
    if (index < 0) {
        // Defensive: a delivery that has never been attempted retries at once.
        return { kind: "retry", delaySeconds: RETRY_LADDER_SECONDS[0], attempt: 1 };
    }
    if (index >= RETRY_LADDER_SECONDS.length) {
        return { kind: "exhausted", attempts: attemptCount };
    }
    return {
        kind: "retry",
        delaySeconds: RETRY_LADDER_SECONDS[index],
        attempt: attemptCount + 1,
    };
}

/**
 * 2xx is success. EVERYTHING ELSE IS A FAILURE, including 3xx.
 *
 * A redirect is not an acceptance: following it would send a signed payload
 * describing a legal agreement to a host the endpoint's owner never registered,
 * which is an open redirect with our signature on it. And a 4xx is retried like
 * any other failure rather than being treated as permanent — a 404 during a
 * deploy is the single most common transient failure a webhook consumer has, and
 * giving up on it immediately would drop exactly the events they most need.
 */
export function isDeliverySuccess(status: number): boolean {
    return status >= 200 && status < 300;
}
