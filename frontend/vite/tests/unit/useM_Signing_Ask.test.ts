import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "../setup/react/wrappers";
import { server } from "../setup/msw/server";
import { edgeFn, http, HttpResponse, ok } from "../setup/msw/handlers";
import { useM_Signing_Ask } from "@/hooks/useM_Signing_Ask";
import type { Signing_Error } from "@/hooks/useQ_Signing_Session";

/**
 * The wire contract between the assistant panel and `signing_ai_ask`.
 *
 * The 429 case is the reason this file exists. `retry_after_seconds` arrives on
 * a REJECTED request, and `utils_Signing_UnwrapError` is the sole place it can
 * be copied across — a field missed there is lost with no type error and no
 * throw, leaving the panel with a disabled button and no countdown to explain
 * it.
 */

describe("useM_Signing_Ask", () => {
    it("parses a 200 answer", async () => {
        server.use(
            http.post(edgeFn("signing_ai_ask"), () =>
                ok({
                    status: "answered",
                    answer: "Ninety days.",
                    citations: [{ page: 1, quote: "ninety (90) days written notice" }],
                    grounded: true,
                    turns_remaining: 29,
                    disclaimer: "Not legal advice.",
                })
            )
        );

        const { result } = renderHookWithProviders(() => useM_Signing_Ask());
        const data = await result.current.mutation.mutateAsync({
            access_token: "token",
            question: "How much notice?",
        });

        expect(data.status).toBe("answered");
        expect(data.citations?.[0].page).toBe(1);
        expect(data.turns_remaining).toBe(29);
    });

    it("carries retry_after_seconds through a 429 — the countdown is unrenderable without it", async () => {
        server.use(
            http.post(edgeFn("signing_ai_ask"), () =>
                HttpResponse.json(
                    { error: "Just a moment — you can ask again shortly.", retry_after_seconds: 5 },
                    { status: 429 }
                )
            )
        );

        const { result } = renderHookWithProviders(() => useM_Signing_Ask());

        await expect(
            result.current.mutation.mutateAsync({ access_token: "token", question: "again?" })
        ).rejects.toThrow();

        await waitFor(() => expect(result.current.mutation.isError).toBe(true));
        const error = result.current.mutation.error as Signing_Error;
        expect(error.retry_after_seconds).toBe(5);
        // The server's own sentence survives, not the generic FunctionsHttpError.
        expect(error.message).toContain("ask again shortly");
    });

    it("surfaces the server's sentence on a 401 rather than a generic one", async () => {
        server.use(
            http.post(edgeFn("signing_ai_ask"), () =>
                HttpResponse.json(
                    { error: "This signing link is no longer valid." },
                    { status: 401 }
                )
            )
        );

        const { result } = renderHookWithProviders(() => useM_Signing_Ask());

        await expect(
            result.current.mutation.mutateAsync({ access_token: "dead", question: "hello?" })
        ).rejects.toThrow("This signing link is no longer valid.");
    });

    it("sends the access token in the BODY, never in a query string", async () => {
        // Query strings leak through Referer headers, server logs and mail-scanner
        // prefetches. The token being in the route path is unavoidable; it must
        // stop there.
        let seenUrl = "";
        let seenBody: Record<string, unknown> = {};

        server.use(
            http.post(edgeFn("signing_ai_ask"), async ({ request }) => {
                seenUrl = request.url;
                seenBody = (await request.json()) as Record<string, unknown>;
                return ok({ status: "answered", answer: "ok", grounded: true });
            })
        );

        const { result } = renderHookWithProviders(() => useM_Signing_Ask());
        await result.current.mutation.mutateAsync({
            access_token: "secret-token-value",
            question: "What is this?",
        });

        expect(seenUrl).not.toContain("secret-token-value");
        expect(seenBody.access_token).toBe("secret-token-value");
        expect(seenBody.question).toBe("What is this?");
    });
});
