import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    Store_SigningAssistant,
    Store_SigningAssistant_Actions,
} from "@/stores/Store_SigningAssistant";

/**
 * The transcript's lifetime, and the one property that is a privacy guarantee
 * rather than a convenience: a thread stored under one signing link must never
 * be rehydrated for a different one in the same tab.
 */

const TOKEN_A = "aaaaaaaaaaaaaaaaaaaaAAAAAA";
const TOKEN_B = "bbbbbbbbbbbbbbbbbbbbBBBBBB";

beforeEach(() => {
    sessionStorage.clear();
    Store_SigningAssistant_Actions.clear();
});

describe("Store_SigningAssistant — turns", () => {
    it("moves a turn from pending to ok", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "What is the term?");
        expect(Store_SigningAssistant.state.turns[0].state).toBe("pending");

        Store_SigningAssistant_Actions.askResolve("t1", {
            state: "ok",
            answer: "Twelve months.",
            grounded: true,
        });

        expect(Store_SigningAssistant.state.turns[0].state).toBe("ok");
        expect(Store_SigningAssistant.state.turns[0].answer).toBe("Twelve months.");
        // The question survives the answer — the panel keeps both on screen.
        expect(Store_SigningAssistant.state.turns[0].question).toBe("What is the term?");
    });

    it("moves a turn to error without losing the question", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "Why?");
        Store_SigningAssistant_Actions.askResolve("t1", { state: "error", error: "Too busy." });

        expect(Store_SigningAssistant.state.turns[0]).toMatchObject({
            state: "error",
            error: "Too busy.",
            question: "Why?",
        });
    });

    it("caps the thread at 20 turns", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        for (let i = 0; i < 30; i++) {
            Store_SigningAssistant_Actions.askStart(`t${i}`, `question ${i}`);
        }

        expect(Store_SigningAssistant.state.turns).toHaveLength(20);
        // The cap drops the OLDEST, so the most recent exchange is always there.
        expect(Store_SigningAssistant.state.turns.at(-1)?.question).toBe("question 29");
    });
});

describe("Store_SigningAssistant — persistence", () => {
    it("rehydrates a thread belonging to the same link", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "kept");
        Store_SigningAssistant_Actions.askResolve("t1", { state: "ok", answer: "yes" });

        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        expect(Store_SigningAssistant.state.turns).toHaveLength(1);
        expect(Store_SigningAssistant.state.turns[0].question).toBe("kept");
    });

    it("DISCARDS a thread belonging to a different link in the same tab", () => {
        // The privacy property. Signer A's questions must never appear for
        // signer B, and no live credential is written to storage to achieve it.
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "signer A's private question");

        Store_SigningAssistant_Actions.hydrate(TOKEN_B);
        expect(Store_SigningAssistant.state.turns).toHaveLength(0);
    });

    it("never writes the access token itself to storage", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "anything");

        const raw = sessionStorage.getItem("cg_signing_assistant") ?? "";
        expect(raw).not.toContain(TOKEN_A);
        expect(raw).toContain(TOKEN_A.slice(-6));
    });

    it("does not restore a stale cooldown or disabled flag", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.setCooldown(30);
        Store_SigningAssistant_Actions.setDisabled(true);

        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        expect(Store_SigningAssistant.state.cooldown).toBe(0);
        expect(Store_SigningAssistant.state.disabled).toBe(false);
    });

    it("clears storage on `clear`, because the ceremony is over", () => {
        Store_SigningAssistant_Actions.hydrate(TOKEN_A);
        Store_SigningAssistant_Actions.askStart("t1", "a question about a clause");

        Store_SigningAssistant_Actions.clear();
        expect(sessionStorage.getItem("cg_signing_assistant")).toBeNull();
        expect(Store_SigningAssistant.state.turns).toHaveLength(0);
    });

    it("a throwing sessionStorage does not propagate — Safari private mode", () => {
        // A courtesy feature must never be able to break the signing surface.
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("SecurityError");
        });

        expect(() => Store_SigningAssistant_Actions.hydrate(TOKEN_A)).not.toThrow();
        expect(() => Store_SigningAssistant_Actions.askStart("t1", "q")).not.toThrow();

        spy.mockRestore();
        getSpy.mockRestore();
    });
});

describe("Store_SigningAssistant — cooldown", () => {
    it("ticks down and stops at zero", () => {
        Store_SigningAssistant_Actions.setCooldown(2);
        Store_SigningAssistant_Actions.tickCooldown();
        expect(Store_SigningAssistant.state.cooldown).toBe(1);
        Store_SigningAssistant_Actions.tickCooldown();
        Store_SigningAssistant_Actions.tickCooldown();
        expect(Store_SigningAssistant.state.cooldown).toBe(0);
    });
});
