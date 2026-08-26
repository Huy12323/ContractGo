import { describe, expect, it } from "vitest";
import { Utils_Rpc_FriendlyError } from "./Utils_Rpc_FriendlyError";

/**
 * The line between "worth showing a person" and "the name of a Postgres
 * function".
 *
 * Both directions are pinned, and the second direction is the one that matters
 * more: it would be easy to make this safe by replacing every message with a
 * generic sentence, and that would throw away the constraint violations and
 * caller-safe refusals that actually tell an admin what to do.
 */

const FALLBACK = "Failed to update the endpoint";

describe("Utils_Rpc_FriendlyError", () => {
    it("replaces this project's SECURITY DEFINER refusals", () => {
        // The exact strings CG-044 and CG-045 raise. An admin shown any of these
        // learns nothing they can act on and is handed a schema detail.
        expect(
            Utils_Rpc_FriendlyError(
                new Error("webhook_endpoint_update: unknown endpoint"),
                FALLBACK
            )
        ).toBe(FALLBACK);
        expect(
            Utils_Rpc_FriendlyError(new Error("api_key_revoke: unknown api key"), FALLBACK)
        ).toBe(FALLBACK);
        expect(
            Utils_Rpc_FriendlyError(
                new Error("api_key_issue: admin or owner role required"),
                FALLBACK
            )
        ).toBe(FALLBACK);
        expect(
            Utils_Rpc_FriendlyError(
                new Error("signer_token_issue_embed: an embed token requires an origin"),
                FALLBACK
            )
        ).toBe(FALLBACK);
    });

    it("replaces a bare SQLSTATE and a permission denial", () => {
        expect(Utils_Rpc_FriendlyError(new Error("42501"), FALLBACK)).toBe(FALLBACK);
        expect(
            Utils_Rpc_FriendlyError(
                new Error("permission denied for function api_key_resolve"),
                FALLBACK
            )
        ).toBe(FALLBACK);
    });

    it("⚠ KEEPS A REAL SENTENCE, including one containing a colon", () => {
        // The failure mode a lazier regex would have: `envelopes_send` and the
        // API both produce messages that are already written for a caller, and
        // some of them carry a colon. Swallowing those would replace the only
        // useful half of the error.
        const real = "Fill your own required fields before sending: 2 remaining";
        expect(Utils_Rpc_FriendlyError(new Error(real), FALLBACK)).toBe(real);

        const constraint =
            'new row for relation "webhook_endpoints" violates check constraint "webhook_endpoints_url_https_check"';
        expect(Utils_Rpc_FriendlyError(new Error(constraint), FALLBACK)).toBe(constraint);

        expect(Utils_Rpc_FriendlyError(new Error("Failed to fetch"), FALLBACK)).toBe(
            "Failed to fetch"
        );
    });

    it("does not mistake a capitalised sentence for a routine name", () => {
        // `INTERNAL_RAISE` requires a lowercase identifier before the colon, so
        // prose that begins with a capital is safe even when it has a colon
        // early on.
        const prose = "Endpoint rejected: your server returned 500";
        expect(Utils_Rpc_FriendlyError(new Error(prose), FALLBACK)).toBe(prose);
    });

    it("falls back for empty, whitespace, and non-error input", () => {
        expect(Utils_Rpc_FriendlyError(new Error(""), FALLBACK)).toBe(FALLBACK);
        expect(Utils_Rpc_FriendlyError(new Error("   "), FALLBACK)).toBe(FALLBACK);
        expect(Utils_Rpc_FriendlyError(null, FALLBACK)).toBe(FALLBACK);
        expect(Utils_Rpc_FriendlyError(undefined, FALLBACK)).toBe(FALLBACK);
        expect(Utils_Rpc_FriendlyError({}, FALLBACK)).toBe(FALLBACK);
    });

    it("accepts a plain string and a message-bearing object", () => {
        // supabase-js hands back `PostgrestError`, which is not an `Error`
        // instance but does carry `message`. Handling only `instanceof Error`
        // would have missed every RPC failure this exists for.
        expect(Utils_Rpc_FriendlyError("api_key_revoke: unknown api key", FALLBACK)).toBe(FALLBACK);
        expect(
            Utils_Rpc_FriendlyError(
                { message: "webhook_endpoint_delete: unknown endpoint" },
                FALLBACK
            )
        ).toBe(FALLBACK);
        expect(Utils_Rpc_FriendlyError({ message: "Something readable" }, FALLBACK)).toBe(
            "Something readable"
        );
    });
});
