import { describe, expect, it } from "vitest";
import {
    utils_Verify_HexFromBuffer,
    utils_Verify_IsSha256,
    utils_Verify_Sha256FromBuffer,
} from "@/pages/Page_Verify/utils_Verify_FileSha256";

// Through `utils_Verify_Sha256FromBuffer`, not the Blob wrapper: jsdom's Blob has
// no `arrayBuffer()`, so testing the wrapper would assert against a polyfill
// instead of against the standard vectors — and the vectors are the point.
const digestOf = (text: string) =>
    utils_Verify_Sha256FromBuffer(new TextEncoder().encode(text).buffer as ArrayBuffer);

// The public verification page's only logic.
//
// Everything here has to agree exactly with the server: `sha256Bytes` in the edge
// functions and `signature_request_verify_by_hash`'s `^[0-9a-f]{64}$` guard. A
// disagreement about casing or length is an unverifiable document with no error
// to explain it, which is the worst possible failure for this surface.

describe("utils_Verify_Sha256FromBuffer", () => {
    it("matches the known SHA-256 of 'abc'", async () => {
        // The standard test vector. If this ever fails, the browser and the
        // server have stopped agreeing about what a fingerprint is.
        expect(await digestOf("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    });

    it("matches the known SHA-256 of the empty input", async () => {
        expect(await digestOf("")).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    });

    it("produces lowercase hex, which is what the server compares against", async () => {
        const digest = await digestOf("abc");
        expect(digest).toBe(digest.toLowerCase());
        expect(digest).toHaveLength(64);
    });
});

describe("utils_Verify_HexFromBuffer", () => {
    it("zero-pads every byte, so a low byte cannot shorten the digest", () => {
        // The classic off-by-one in a hand-rolled hex encoder: 0x0a rendering as
        // "a" instead of "0a", which produces a 63-character "fingerprint" the
        // server rejects for a reason nobody can see.
        const buffer = new Uint8Array([0x00, 0x0a, 0xff]).buffer;
        expect(utils_Verify_HexFromBuffer(buffer)).toBe("000aff");
    });
});

describe("utils_Verify_IsSha256", () => {
    it("accepts a well-formed digest", () => {
        expect(utils_Verify_IsSha256("a".repeat(64))).toBe(true);
    });

    it("accepts one someone pasted in uppercase", () => {
        // `sha256sum` on some platforms and most hex viewers produce uppercase.
        // Refusing it would be a dead end over something the client can normalise.
        expect(utils_Verify_IsSha256("A".repeat(64))).toBe(true);
    });

    it("tolerates surrounding whitespace from a copy and paste", () => {
        expect(utils_Verify_IsSha256(`  ${"a".repeat(64)}\n`)).toBe(true);
    });

    it("rejects the wrong length", () => {
        expect(utils_Verify_IsSha256("a".repeat(63))).toBe(false);
        expect(utils_Verify_IsSha256("a".repeat(65))).toBe(false);
    });

    it("rejects non-hex characters", () => {
        expect(utils_Verify_IsSha256(`${"a".repeat(63)}z`)).toBe(false);
    });

    it("rejects an empty string", () => {
        expect(utils_Verify_IsSha256("")).toBe(false);
    });
});
