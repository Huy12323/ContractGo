import { describe, expect, it } from "vitest";
import {
    Signing_Session_QueryKey,
    utils_Signing_IsMyField,
    utils_Signing_IsSignatureField,
    utils_Signing_UnwrapError,
    type Signing_Error,
    type Signing_Field,
} from "./useQ_Signing_Session";

/**
 * The two predicates the signing surface routes on.
 *
 * Four places have to agree on IsSignatureField — the filler, the sign step, the
 * completion check, and `signing_submit`'s own `mySignatureFields` filter. When
 * they disagreed, the signer hit a dead end: the sign step decided no mark was
 * needed, the server disagreed, and the rejection bounced them back to a filler
 * with nothing visibly wrong in it. That is unrecoverable from the signer's side.
 */

const field = (over: Partial<Signing_Field> = {}): Signing_Field => ({
    id: "tfd_1",
    key: "signature",
    label: "Signature",
    type: "signature",
    role_id: "rol_a",
    required: true,
    page: 1,
    x_pct: 0,
    y_pct: 0,
    w_pct: 10,
    h_pct: 5,
    editable: false,
    ...over,
});

describe("utils_Signing_IsSignatureField", () => {
    it("is true for signature and initials", () => {
        expect(utils_Signing_IsSignatureField(field({ type: "signature" }))).toBe(true);
        expect(utils_Signing_IsSignatureField(field({ type: "initials" }))).toBe(true);
    });

    it("is false for every other field type", () => {
        for (const type of ["text", "date", "checkbox", "select", "attachment", ""]) {
            expect(utils_Signing_IsSignatureField(field({ type }))).toBe(false);
        }
    });

    it("decides on type alone — never on `editable`", () => {
        // signing_session_open sets editable=false for EVERY signature field,
        // because a signature is captured on the sign step and never typed. If
        // this predicate consulted `editable`, no signature would ever be
        // recognised as one.
        expect(utils_Signing_IsSignatureField(field({ type: "signature", editable: false }))).toBe(
            true
        );
        expect(utils_Signing_IsSignatureField(field({ type: "text", editable: true }))).toBe(false);
    });
});

describe("utils_Signing_IsMyField", () => {
    it("decides ownership by ROLE, not by editable", () => {
        // The box IS the signer's, which is precisely why they are asked for a
        // mark at all — even though they may not type into it.
        expect(utils_Signing_IsMyField(field({ role_id: "rol_a", editable: false }), "rol_a")).toBe(
            true
        );
        expect(utils_Signing_IsMyField(field({ role_id: "rol_b", editable: true }), "rol_a")).toBe(
            false
        );
    });

    it("is false when the signer has no role", () => {
        expect(utils_Signing_IsMyField(field({ role_id: "rol_a" }), "")).toBe(false);
    });
});

describe("Signing_Session_QueryKey", () => {
    it("namespaces by access token", () => {
        // This sits outside the QueryKeys factory, so nothing would catch a
        // drifting string literal at compile time.
        expect(Signing_Session_QueryKey("tok_1")).toEqual(["signing_session", "tok_1"]);
        expect(Signing_Session_QueryKey("tok_2")).not.toEqual(Signing_Session_QueryKey("tok_1"));
    });
});

/**
 * THE SOLE UNWRAP POINT ON THE SIGNER SURFACE, and a silent-loss hazard by
 * construction: `functions.invoke` reports every non-2xx as a generic
 * `FunctionsHttpError` and keeps the real body on `context`, so a structured
 * field the server sends and this function does not copy across is lost with no
 * type error, no throw, and no way for the page to notice. Every refusal the
 * signing surface ACTS on rather than prints comes through here.
 *
 * Overdue independently of v1.2.0 — the eKYC assertion is one `it` block and
 * deletes cleanly.
 */
const httpError = (body: unknown, status = 400) => ({
    context: new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    }),
});

describe("utils_Signing_UnwrapError", () => {
    it("replaces the generic message with the one written FOR the signer", () => {
        // The whole reason this function exists: "Edge Function returned a
        // non-2xx status code" is useless; "This signing link is no longer
        // valid" is not.
        return utils_Signing_UnwrapError(
            httpError({ error: "This signing link is no longer valid." }, 401)
        ).then((err) => {
            expect(err.message).toBe("This signing link is no longer valid.");
        });
    });

    it("carries `code`, which is what the page branches on", async () => {
        for (const code of [
            "sign_in_required",
            "account_mismatch",
            "email_not_verified",
            "otp_required",
            "identity_check_required", // [ekyc]
        ] as const) {
            const err = (await utils_Signing_UnwrapError(
                httpError({ error: "nope", code }, 403)
            )) as Signing_Error;
            expect(err.code).toBe(code);
        }
    });

    it("carries `missing_fields`, so the filler can point at them", async () => {
        const err = (await utils_Signing_UnwrapError(
            httpError({
                error: "Some fields are missing.",
                missing_fields: [{ id: "tfd_1", label: "Name" }],
            })
        )) as Signing_Error;
        expect(err.missing_fields).toEqual([{ id: "tfd_1", label: "Name" }]);
    });

    it("carries `retry_after_seconds` and `attempts_remaining`", async () => {
        const err = (await utils_Signing_UnwrapError(
            httpError({ error: "Too many.", retry_after_seconds: 42, attempts_remaining: 3 }, 429)
        )) as Signing_Error;
        expect(err.retry_after_seconds).toBe(42);
        expect(err.attempts_remaining).toBe(3);
    });

    it("invents a sentence for the one refusal that carries no `error`", async () => {
        // `signing_otp_send`'s cooldown is a 429 carrying only a countdown,
        // because being told to wait is an answer rather than a failure. It still
        // has to travel as a thrown error, so it is given words here.
        const err = await utils_Signing_UnwrapError(
            httpError({ status: "cooldown", retry_after_seconds: 12 }, 429)
        );
        expect(err.message).toMatch(/wait/i);
        expect((err as Signing_Error).retry_after_seconds).toBe(12);
    });

    it("[ekyc] carries `identity_reason` — the only thing that tells a rejected signer what to fix", async () => {
        const err = (await utils_Signing_UnwrapError(
            httpError(
                {
                    error: "Verify your identity before signing.",
                    code: "identity_check_required",
                    reason: "document unreadable",
                },
                403
            )
        )) as Signing_Error;
        expect(err.identity_reason).toBe("document unreadable");
    });

    it("passes a non-Response error through unchanged", async () => {
        const original = new Error("network down");
        expect(await utils_Signing_UnwrapError(original)).toBe(original);
    });

    it("wraps a non-Error thrown value rather than losing it", async () => {
        const err = await utils_Signing_UnwrapError("something odd");
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("something odd");
    });

    it("falls back to the original error when the body is not JSON", async () => {
        const original = { context: new Response("<html>502</html>", { status: 502 }) };
        const err = await utils_Signing_UnwrapError(original);
        // Not an Error instance, so it is stringified rather than dropped.
        expect(err).toBeInstanceOf(Error);
    });
});
