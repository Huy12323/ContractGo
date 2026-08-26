import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSignature, signedPayload } from "../../../supabase/functions/_shared/webhookSign.ts";

/**
 * ⚠ THIS TEST READS THE DOCUMENTATION AS ITS INPUT, WHICH IS THE ENTIRE POINT.
 *
 * The webhook signature is the one part of this product a THIRD PARTY has to
 * reimplement, from prose, in a language we did not choose. `webhookSign.test.ts`
 * already pins the implementation against an independently-computed HMAC — but
 * an implementation that is right while the documented example is wrong is
 * indistinguishable, to an integrator, from an implementation that is wrong.
 * They only ever see the documentation.
 *
 * So the vector below is not written here. It is PARSED OUT OF `docs/api.md`,
 * and asserted against the same code that signs real deliveries. Change either
 * one without the other and this fails.
 *
 * The same applies to the event vocabulary: it is a public contract that
 * consumers switch on, and the list in the documentation is checked against the
 * enum and the mapping function in `cg045`, not against a copy kept here. A
 * second copy of a contract is a second thing to keep in agreement, which is the
 * failure mode this file exists to prevent rather than to add to.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const API_DOC = readFileSync(path.join(REPO_ROOT, "docs/api.md"), "utf8");
const EMBED_DOC = readFileSync(path.join(REPO_ROOT, "docs/embedding.md"), "utf8");

const MIGRATIONS_DIR = path.resolve(HERE, "../../../supabase/migrations");
const CG045 = readFileSync(
    path.join(
        MIGRATIONS_DIR,
        readdirSync(MIGRATIONS_DIR).find((f) => f.includes("cg045")) as string
    ),
    "utf8"
);

/** Pull `label:   value` out of the documented test-vector block. */
function docVector(label: string): string {
    const match = API_DOC.match(new RegExp(`^${label}:\\s+(.+)$`, "m"));
    if (!match) throw new Error(`docs/api.md no longer states a "${label}:" in its test vector`);
    return match[1]!.trim();
}

describe("docs/api.md — the documented signature vector", () => {
    it("is exactly what buildSignature produces", async () => {
        const secret = docVector("secret");
        const timestamp = Number(docVector("timestamp"));
        const body = docVector("body");
        const documented = docVector("signature");

        expect(Number.isFinite(timestamp)).toBe(true);

        const actual = await buildSignature({ secret, body, timestampSeconds: timestamp });

        // If this fails, the copy-pasteable snippets in the documentation do not
        // verify a real delivery. Fix the documentation, not this assertion.
        expect(actual).toBe(documented);
    });

    it("documents the signed string as `<timestamp>.<body>`, which is what is signed", () => {
        const timestamp = Number(docVector("timestamp"));
        const body = docVector("body");

        // Both snippets build `${timestamp}.${rawBody}` by hand. That expression
        // is the contract; `signedPayload` is our side of it.
        expect(signedPayload(timestamp, body)).toBe(`${timestamp}.${body}`);
    });

    it("keeps the Node and Python snippets on the same construction", () => {
        // Not a proof — Python is not executed here, and saying otherwise would
        // be a bigger problem than the gap. What IS checked is that neither
        // snippet has drifted onto a different signed string or a non-constant
        // -time comparison, which are the two ways a verification example goes
        // quietly wrong.
        expect(API_DOC).toContain("`${timestamp}.${rawBody}`");
        expect(API_DOC).toContain("f\"{timestamp}.{raw_body.decode('utf-8')}\"");
        expect(API_DOC).toContain("crypto.timingSafeEqual");
        expect(API_DOC).toContain("hmac.compare_digest");
        expect(API_DOC).toContain("hashlib.sha256");
    });
});

describe("docs/api.md — the public event vocabulary", () => {
    const enumValues = (() => {
        const block = CG045.match(
            /CREATE TYPE public\.webhook_endpoints_events_enum AS ENUM \(([\s\S]*?)\);/
        );
        if (!block) throw new Error("cg045 no longer declares webhook_endpoints_events_enum");
        return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    })();

    it("lists every event the database can emit, and no event it cannot", () => {
        expect(enumValues.length).toBeGreaterThan(0);

        for (const value of enumValues) {
            expect(API_DOC, `docs/api.md does not document the event ${value}`).toContain(
                `\`${value}\``
            );
        }

        // The reverse direction: a documented `envelope.*` event that the enum
        // does not contain is a promise nothing can keep.
        //
        // Scanned over the "### Events" table ALONE, not the whole file. The
        // prose elsewhere refers to `envelope.status` — a field on the payload,
        // not an event — and a looser scan reads that as a broken promise. It
        // was written loosely first and this is exactly what it caught.
        const eventsSection = API_DOC.slice(
            API_DOC.indexOf("### Events"),
            API_DOC.indexOf("### Payload")
        );
        expect(eventsSection.length).toBeGreaterThan(0);
        const documented = new Set(
            [...eventsSection.matchAll(/`(envelope\.[a-z_]+)`/g)].map((m) => m[1]!)
        );
        for (const value of documented) {
            expect(enumValues, `docs/api.md documents ${value}, which cg045 cannot emit`).toContain(
                value
            );
        }
    });

    it("documents the ladder and the breaker the pump actually uses", () => {
        expect(API_DOC).toContain("1m → 5m → 30m → 2h → 12h → 24h");
        expect(API_DOC).toContain("**10 consecutive failures**");
    });

    it("tells integrators to dedupe on event_id, before anything else about webhooks", () => {
        // Dedupe is buried in most webhook documentation and it is the single
        // thing an at-least-once system most needs read. It leads.
        const dedupe = API_DOC.indexOf("Dedupe on `event_id`");
        expect(dedupe).toBeGreaterThan(-1);
        expect(dedupe).toBeLessThan(API_DOC.indexOf("## Endpoints"));
    });
});

describe("docs/embedding.md", () => {
    it("states the TTL clamp and the use cap the endpoint enforces", () => {
        expect(EMBED_DOC).toContain("`[60, 3600]`");
        expect(EMBED_DOC).toContain("**three uses**");
    });

    it("tells the host to check event.origin and the message envelope", () => {
        // Every one of these is a real vulnerability in a host page that omits
        // it: any page can postMessage into any window it holds a handle to.
        expect(EMBED_DOC).toContain("event.origin");
        expect(EMBED_DOC).toContain('msg.source !== "contractgo"');
        expect(EMBED_DOC).toContain("msg.version !== 1");
    });

    it("warns that completed_all must be checked for true, not for truthiness", () => {
        expect(EMBED_DOC).toContain("msg.completed_all === true");
    });

    it("names email_otp as the auth mode embedded signing requires", () => {
        expect(EMBED_DOC).toContain('"signer_auth": "email_otp"');
    });
});
