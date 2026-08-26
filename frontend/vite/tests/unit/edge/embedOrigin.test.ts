import { describe, expect, it } from "vitest";
import {
    isOriginAllowed,
    normalizeOrigin,
} from "../../../supabase/functions/_shared/embedOrigin.ts";

/**
 * The comparison that decides where a signing session may report a legal
 * ceremony's progress.
 *
 * Every case here is either "this must match" or "this must NOT match", and the
 * second kind is the reason the file exists. An over-permissive origin check
 * does not fail loudly — it works perfectly, for the wrong site.
 */

describe("normalizeOrigin", () => {
    it("accepts a bare origin unchanged", () => {
        expect(normalizeOrigin("https://app.example.com")).toBe("https://app.example.com");
        expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    });

    it("lowercases scheme and host, because hostnames are case-insensitive", () => {
        // An integrator whose config file capitalises a hostname is not a
        // different integrator, and refusing them would be a support ticket with
        // no security benefit.
        expect(normalizeOrigin("HTTPS://App.Example.COM")).toBe("https://app.example.com");
    });

    it("collapses an explicit default port onto the implicit one", () => {
        // The two forms name the same origin. A browser's `event.origin` never
        // includes a default port, so a key that registered one would otherwise
        // never match anything a browser reports.
        expect(normalizeOrigin("https://app.example.com:443")).toBe("https://app.example.com");
        expect(normalizeOrigin("http://app.example.com:80")).toBe("http://app.example.com");
    });

    it("keeps a NON-default port, which is a different origin", () => {
        expect(normalizeOrigin("https://app.example.com:8443")).toBe(
            "https://app.example.com:8443"
        );
        // Same host, different port — and the browser treats them as different
        // origins, so this check must too.
        expect(normalizeOrigin("http://localhost:5173")).not.toBe(
            normalizeOrigin("http://localhost:4173")
        );
    });

    it("refuses anything carrying a path, query or fragment", () => {
        // Accepting these and silently truncating would store a string that
        // reads narrower than it behaves: `postMessage` ignores everything after
        // the origin, so `https://a.com/embed` would in fact target all of a.com.
        expect(normalizeOrigin("https://app.example.com/embed")).toBeNull();
        expect(normalizeOrigin("https://app.example.com/")).toBeNull();
        expect(normalizeOrigin("https://app.example.com?a=1")).toBeNull();
        expect(normalizeOrigin("https://app.example.com#x")).toBeNull();
    });

    it("refuses wildcards in every form", () => {
        expect(normalizeOrigin("*")).toBeNull();
        expect(normalizeOrigin("https://*")).toBeNull();
        expect(normalizeOrigin("https://*.example.com")).toBeNull();
    });

    it("refuses schemes other than http and https", () => {
        // `javascript:` and `data:` are the interesting ones — a stored origin
        // is used verbatim as a postMessage target, and `file://` origins are
        // opaque and compare as "null".
        expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
        expect(normalizeOrigin("data:text/html,x")).toBeNull();
        expect(normalizeOrigin("file:///etc/passwd")).toBeNull();
        expect(normalizeOrigin("ftp://example.com")).toBeNull();
    });

    it("refuses embedded credentials", () => {
        // `https://evil.com@good.com` reads as good.com to a human skimming a
        // config and parses with evil.com as the userinfo. Refused on shape
        // before any parsing happens.
        expect(normalizeOrigin("https://evil.com@good.com")).toBeNull();
    });

    it("refuses empty and non-string input", () => {
        expect(normalizeOrigin("")).toBeNull();
        expect(normalizeOrigin("   ")).toBeNull();
        expect(normalizeOrigin(null)).toBeNull();
        expect(normalizeOrigin(undefined)).toBeNull();
    });
});

describe("isOriginAllowed", () => {
    const allowed = ["https://app.example.com", "http://localhost:5173"];

    it("matches a registered origin", () => {
        expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
        expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
    });

    it("matches across equivalent spellings on either side", () => {
        expect(isOriginAllowed("HTTPS://App.Example.com:443", allowed)).toBe(true);
        expect(isOriginAllowed("https://app.example.com", ["https://APP.example.com:443"])).toBe(
            true
        );
    });

    it("refuses an origin that was not registered", () => {
        expect(isOriginAllowed("https://evil.example.com", allowed)).toBe(false);
        // A subdomain of a registered host is a DIFFERENT origin. This is the
        // case an integrator will ask us to relax, and the answer is to register
        // the subdomain, not to prefix-match.
        expect(isOriginAllowed("https://staging.app.example.com", allowed)).toBe(false);
        // Suffix matching would accept this; it is a host somebody else owns.
        expect(isOriginAllowed("https://app.example.com.evil.net", allowed)).toBe(false);
    });

    it("refuses on scheme mismatch", () => {
        // http and https are different origins, and downgrading is exactly what
        // an attacker on the network would want.
        expect(isOriginAllowed("http://app.example.com", allowed)).toBe(false);
    });

    it("⚠ TREATS AN EMPTY ALLOWLIST AS 'NEVER', NOT AS 'ANY'", () => {
        // The single most important assertion in this file. An empty list is the
        // DEFAULT for every API key ever minted, so if it meant "any" then every
        // key in the product would be able to aim signing events anywhere.
        expect(isOriginAllowed("https://app.example.com", [])).toBe(false);
        expect(isOriginAllowed("https://anything.at.all", [])).toBe(false);
    });

    it("never lets a wildcard match, from either side", () => {
        expect(isOriginAllowed("*", allowed)).toBe(false);
        expect(isOriginAllowed("https://app.example.com", ["*"])).toBe(false);
        expect(isOriginAllowed("https://app.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("skips a malformed registered entry rather than comparing it raw", () => {
        // A row that cannot normalize must not match by string equality, or a
        // stored `https://a.com/` would match a request for `https://a.com/`
        // while meaning something else to the browser.
        expect(isOriginAllowed("https://a.com/", ["https://a.com/"])).toBe(false);
        expect(isOriginAllowed("https://app.example.com", ["not an origin", ...allowed])).toBe(
            true
        );
    });
});
