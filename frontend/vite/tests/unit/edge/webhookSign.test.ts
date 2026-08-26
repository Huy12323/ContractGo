import { describe, expect, it } from "vitest";
import {
    buildSignature,
    CIRCUIT_BREAKER_THRESHOLD,
    isDeliverySuccess,
    nextAttempt,
    RETRY_LADDER_SECONDS,
    signedPayload,
} from "../../../supabase/functions/_shared/webhookSign.ts";

/**
 * The webhook system's two pure decisions.
 *
 * The signature is the one part of this product a THIRD PARTY has to
 * reimplement, from documentation, in a language we did not choose. A signed
 * webhook nobody can verify is an unsigned webhook — so the vector below is
 * pinned against an independently-computable HMAC, and `docs/api.md`'s
 * copy-pasteable snippets are written to produce exactly it.
 *
 * The ladder is where an off-by-one is invisible in review and shows up in
 * production as either a doubled first retry or a silently skipped final one.
 */

describe("signedPayload", () => {
    it("is `<timestamp>.<body>` — the string a consumer must reconstruct", () => {
        expect(signedPayload(1700000000, '{"a":1}')).toBe('1700000000.{"a":1}');
    });

    it("binds the timestamp INSIDE the signed string, not merely beside it", () => {
        // If the body alone were signed, these two would be identical and a
        // captured request could be replayed forever with a valid signature.
        expect(signedPayload(1, "x")).not.toBe(signedPayload(2, "x"));
    });
});

describe("buildSignature", () => {
    // Independently verifiable:
    //   printf '1700000000.{"hello":"world"}' \
    //     | openssl dgst -sha256 -hmac 'whsec_test_secret' -hex
    const VECTOR = {
        secret: "whsec_test_secret",
        body: '{"hello":"world"}',
        timestampSeconds: 1700000000,
    };

    it("emits the Stripe-shaped header", async () => {
        const header = await buildSignature(VECTOR);
        expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    });

    it("is deterministic — the same inputs always produce the same header", async () => {
        // The property a consumer's verification depends on. If this were ever
        // non-deterministic (a random nonce, an object re-serialization), every
        // consumer would reject every delivery.
        expect(await buildSignature(VECTOR)).toBe(await buildSignature(VECTOR));
    });

    it("changes when the SECRET changes", async () => {
        const a = await buildSignature(VECTOR);
        const b = await buildSignature({ ...VECTOR, secret: "whsec_other" });
        expect(a).not.toBe(b);
    });

    it("changes when the BODY changes by one byte", async () => {
        const a = await buildSignature(VECTOR);
        const b = await buildSignature({ ...VECTOR, body: '{"hello":"World"}' });
        expect(a).not.toBe(b);
    });

    it("changes when only the TIMESTAMP changes", async () => {
        // Proves the timestamp is genuinely inside the MAC rather than just
        // prefixed to the header — the anti-replay property.
        const a = await buildSignature(VECTOR);
        const b = await buildSignature({ ...VECTOR, timestampSeconds: 1700000001 });
        expect(a.split("v1=")[1]).not.toBe(b.split("v1=")[1]);
    });

    it("matches a known-good HMAC vector", async () => {
        // Computed independently of this implementation. If someone "optimises"
        // the signing — hashing the object, changing the separator, switching to
        // base64 — this is the test that says every existing consumer just broke.
        const header = await buildSignature(VECTOR);
        // Produced by Node's crypto, not by this module:
        //   crypto.createHmac("sha256", "whsec_test_secret")
        //         .update('1700000000.{"hello":"world"}').digest("hex")
        expect(header).toBe(
            "t=1700000000,v1=86748dbec9cc87a9219f8a96632da703271bf5e85aa0afa2b310c37ba059d514"
        );
    });
});

describe("nextAttempt", () => {
    it("walks the documented ladder in order", () => {
        expect(RETRY_LADDER_SECONDS).toEqual([60, 300, 1800, 7200, 43200, 86400]);
        // `attemptCount` is the number ALREADY made, so the first failure is 1
        // and must take the FIRST rung — not the second.
        expect(nextAttempt(1)).toEqual({ kind: "retry", delaySeconds: 60, attempt: 2 });
        expect(nextAttempt(2)).toEqual({ kind: "retry", delaySeconds: 300, attempt: 3 });
        expect(nextAttempt(6)).toEqual({ kind: "retry", delaySeconds: 86400, attempt: 7 });
    });

    it("gives up AFTER the last rung, not before it", () => {
        // The off-by-one that would silently skip the 24-hour retry.
        expect(nextAttempt(6).kind).toBe("retry");
        expect(nextAttempt(7)).toEqual({ kind: "exhausted", attempts: 7 });
        expect(nextAttempt(99).kind).toBe("exhausted");
    });

    it("retries immediately for a delivery that has never been attempted", () => {
        expect(nextAttempt(0)).toEqual({ kind: "retry", delaySeconds: 60, attempt: 1 });
    });

    it("spans a little under two days in total", () => {
        const total = RETRY_LADDER_SECONDS.reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(36 * 3600);
        expect(total).toBeLessThan(48 * 3600);
    });
});

describe("isDeliverySuccess", () => {
    it("accepts 2xx only", () => {
        expect(isDeliverySuccess(200)).toBe(true);
        expect(isDeliverySuccess(201)).toBe(true);
        expect(isDeliverySuccess(204)).toBe(true);
        expect(isDeliverySuccess(299)).toBe(true);
    });

    it("treats 3xx as a FAILURE", () => {
        // Not pedantry. Following a redirect would POST a signed payload
        // describing a legal agreement to a host the endpoint's owner never
        // registered — an open redirect carrying our signature. The pump sets
        // `redirect: "manual"`, and this is the half that makes the 3xx it then
        // sees count as a failure rather than a success.
        expect(isDeliverySuccess(301)).toBe(false);
        expect(isDeliverySuccess(302)).toBe(false);
        expect(isDeliverySuccess(307)).toBe(false);
    });

    it("treats 4xx as a retryable failure like any other", () => {
        // A 404 during a deploy is the most common transient failure a webhook
        // consumer has. Giving up on it immediately would drop exactly the
        // events they most need.
        expect(isDeliverySuccess(404)).toBe(false);
        expect(isDeliverySuccess(410)).toBe(false);
        expect(isDeliverySuccess(500)).toBe(false);
    });
});

describe("CIRCUIT_BREAKER_THRESHOLD", () => {
    it("is high enough to outlast the whole ladder", () => {
        // An endpoint must not be disabled while a single delivery is still
        // working through its retries — otherwise a one-off outage disables the
        // integration before the retry that would have succeeded.
        expect(CIRCUIT_BREAKER_THRESHOLD).toBeGreaterThan(RETRY_LADDER_SECONDS.length);
    });
});
