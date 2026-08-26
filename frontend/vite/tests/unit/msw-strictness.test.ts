import { describe, expect, it } from "vitest";
import { edgeFn, http, ok, supabaseUrl } from "../setup/msw/handlers";
import { server as mswServer } from "../setup/msw/server";

/**
 * V-MSW. Proves the `onUnhandledRequest: "error"` contract is actually wired.
 *
 * If this file passes trivially, every other test in the suite is silently
 * making real network calls — which is why the strictness is asserted rather
 * than assumed. Delete this only if MSW is removed.
 */
describe("MSW strictness", () => {
    it("rejects a request no test declared", async () => {
        // The design: an unexpected request FAILS instead of hanging or hitting
        // the network. If your test errors here, add a server.use(...).
        await expect(fetch("https://example.test/rest/v1/organizations")).rejects.toThrow();
    });

    it("allows a request a test declares with server.use", async () => {
        mswServer.use(http.get(supabaseUrl("/rest/v1/organizations"), () => ok([{ id: "org_1" }])));
        const response = await fetch("https://example.test/rest/v1/organizations");
        await expect(response.json()).resolves.toEqual([{ id: "org_1" }]);
    });

    it("matches edge-function endpoints through the edgeFn helper", async () => {
        mswServer.use(http.post(edgeFn("envelopes_send"), () => ok({ success: true })));
        const response = await fetch("https://example.test/functions/v1/envelopes_send", {
            method: "POST",
        });
        await expect(response.json()).resolves.toEqual({ success: true });
    });
});

// Re-export guard: handlers.ts must stay empty, or the strictness above is moot.
describe("MSW handler list", () => {
    it("is intentionally empty", async () => {
        const { handlers } = await import("../setup/msw/handlers");
        expect(handlers).toEqual([]);
    });
});
