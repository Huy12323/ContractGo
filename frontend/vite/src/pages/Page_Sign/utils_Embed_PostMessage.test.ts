import { describe, expect, it, vi } from "vitest";
import {
    EMBED_MESSAGE_SOURCE,
    EMBED_MESSAGE_VERSION,
    utils_Embed_BuildMessage,
    utils_Embed_Post,
    utils_Embed_ShouldEmit,
} from "./utils_Embed_PostMessage";

/**
 * The embed bridge — CG-047.
 *
 * Two kinds of assertion live here and the second kind is the point. One kind
 * pins the message SHAPE, which is a public contract a third party writes a
 * listener against. The other pins every case in which this module must say
 * NOTHING, because a `postMessage` that goes to the wrong place does not throw,
 * does not log, and does not fail a build — it simply hands a legal ceremony's
 * progress to a site nobody registered.
 */

const makeTarget = () => {
    const calls: { message: unknown; targetOrigin: string }[] = [];
    return {
        calls,
        postMessage: (message: unknown, targetOrigin: string) =>
            void calls.push({ message, targetOrigin }),
    };
};

const ORIGIN = "https://host.example.com";

describe("utils_Embed_BuildMessage", () => {
    it("tags every message with source and version", () => {
        // The source tag is what lets a host page tell OUR events from every
        // other frame, extension and script that can reach its `message`
        // listener. `docs/embedding.md` tells integrators to check it alongside
        // `event.origin`, and that instruction is only followable because this
        // is unconditional.
        const msg = utils_Embed_BuildMessage("ready");
        expect(msg.source).toBe(EMBED_MESSAGE_SOURCE);
        expect(msg.source).toBe("contractgo");
        expect(msg.version).toBe(EMBED_MESSAGE_VERSION);
        expect(msg.type).toBe("ready");
    });

    it("omits ids it was not given rather than sending nulls", () => {
        const msg = utils_Embed_BuildMessage("ready", { envelopeId: null, signerId: undefined });
        expect(msg).not.toHaveProperty("envelope_id");
        expect(msg).not.toHaveProperty("signer_id");
    });

    it("carries the ids on loaded", () => {
        const msg = utils_Embed_BuildMessage("loaded", { envelopeId: "sr_1", signerId: "srs_1" });
        expect(msg.envelope_id).toBe("sr_1");
        expect(msg.signer_id).toBe("srs_1");
    });

    it("carries completed_all ONLY on completed", () => {
        expect(utils_Embed_BuildMessage("completed", { completedAll: true }).completed_all).toBe(
            true
        );
        expect(utils_Embed_BuildMessage("completed", { completedAll: false }).completed_all).toBe(
            false
        );
        // A declined document has no such concept, and sending the key would
        // invite a host to branch on it.
        expect(utils_Embed_BuildMessage("declined", { completedAll: true })).not.toHaveProperty(
            "completed_all"
        );
    });

    it("⚠ drops an UNKNOWN completed_all instead of sending false", () => {
        // `false` is a claim: "more signatures are outstanding". `undefined` is
        // "we did not determine this". A host closing its frame on the strength
        // of the first is right; on the strength of a coerced second it would
        // leave a finished contract's frame open forever.
        expect(utils_Embed_BuildMessage("completed", {})).not.toHaveProperty("completed_all");
        expect(
            utils_Embed_BuildMessage("completed", { completedAll: undefined })
        ).not.toHaveProperty("completed_all");
    });

    it("never carries an error reason", () => {
        // The host page belongs to the integrator, not to the signer. A refusal
        // on this surface can name a mailbox, a passcode state or an identity
        // verdict; the signer reads it inside the frame, where their token
        // already entitles them to it.
        const msg = utils_Embed_BuildMessage("error", { envelopeId: "sr_1" });
        expect(Object.keys(msg).sort()).toEqual(["envelope_id", "source", "type", "version"]);
    });
});

describe("utils_Embed_ShouldEmit", () => {
    it("emits for a framed page with a real origin", () => {
        expect(utils_Embed_ShouldEmit(ORIGIN, true)).toBe(true);
        expect(utils_Embed_ShouldEmit("http://localhost:5173", true)).toBe(true);
    });

    it("⚠ SAYS NOTHING WHEN THE CREDENTIAL CARRIES NO ORIGIN", () => {
        // This is the case for EVERY emailed link — every token this product
        // issued before v1.4.0 and every one `envelopes_send` issues today. An
        // absent origin is silence, never a wildcard.
        expect(utils_Embed_ShouldEmit(null, true)).toBe(false);
        expect(utils_Embed_ShouldEmit(undefined, true)).toBe(false);
        expect(utils_Embed_ShouldEmit("", true)).toBe(false);
        expect(utils_Embed_ShouldEmit("   ", true)).toBe(false);
    });

    it("⚠ REFUSES A WILDCARD EXPLICITLY", () => {
        // Refused by name and not merely by failing the shape test below, so
        // that a `*` arriving by some route nobody has thought of yet produces
        // silence rather than a broadcast to whatever page happens to be framing
        // this one.
        expect(utils_Embed_ShouldEmit("*", true)).toBe(false);
        expect(utils_Embed_ShouldEmit("https://*.example.com", true)).toBe(false);
    });

    it("refuses an origin carrying a path or a hostile scheme", () => {
        expect(utils_Embed_ShouldEmit("https://host.example.com/embed", true)).toBe(false);
        expect(utils_Embed_ShouldEmit("javascript:alert(1)", true)).toBe(false);
    });

    it("says nothing when the page is not framed", () => {
        // Not a security property — it is what stops a signer who opened an embed
        // URL directly in a tab from posting messages to their own window.
        expect(utils_Embed_ShouldEmit(ORIGIN, false)).toBe(false);
    });
});

describe("utils_Embed_Post", () => {
    it("posts to the credential's origin and NEVER to '*'", () => {
        const target = makeTarget();
        expect(utils_Embed_Post(target, ORIGIN, true, "loaded", { envelopeId: "sr_1" })).toBe(true);
        expect(target.calls).toHaveLength(1);
        const sent = target.calls[0]!;
        expect(sent.targetOrigin).toBe(ORIGIN);
        expect(sent.targetOrigin).not.toBe("*");
        expect(sent.message).toMatchObject({
            source: "contractgo",
            version: 1,
            type: "loaded",
            envelope_id: "sr_1",
        });
    });

    it("is a no-op with no target window", () => {
        expect(utils_Embed_Post(null, ORIGIN, true, "ready")).toBe(false);
    });

    it("does not call postMessage at all when it must stay silent", () => {
        // The assertion is on the SPY, not just the return value: a bridge that
        // returned false after already having posted would pass a weaker test.
        for (const origin of [null, undefined, "", "*", "https://a.com/x"]) {
            const target = makeTarget();
            expect(utils_Embed_Post(target, origin, true, "completed")).toBe(false);
            expect(target.calls).toHaveLength(0);
        }

        const unframed = makeTarget();
        expect(utils_Embed_Post(unframed, ORIGIN, false, "completed")).toBe(false);
        expect(unframed.calls).toHaveLength(0);
    });

    it("swallows a throwing postMessage rather than killing the ceremony", () => {
        // A signature must not fail because a host page's registration was odd.
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const target = {
            postMessage: () => {
                throw new Error("SyntaxError: invalid target origin");
            },
        };
        expect(utils_Embed_Post(target, ORIGIN, true, "completed")).toBe(false);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
