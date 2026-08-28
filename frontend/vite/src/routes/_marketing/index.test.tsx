// The one guard on the marketing branch, and the thing it must NOT catch.
//
// `/` redirects a signed-in visitor to their dashboard. The failure mode worth
// testing is not the redirect itself — it is the redirect being placed one level
// too high. On the `_marketing` layout it would run for every child of that
// branch, and the moment a second public page is added under it (pricing, docs,
// a case study) that page would become invisible to anyone with an account,
// which is exactly the audience most likely to open it from inside the app.
//
// The guard is INVOKED DIRECTLY rather than through a router built for the test.
// Standing up a local route tree meant re-declaring routes whose types are bound
// to the app's registered router, and the casts needed to make that compile were
// doing more to hide mistakes than the test was doing to catch them. A
// `beforeLoad` is an async function that either returns or throws a redirect;
// calling it and inspecting what comes back tests exactly that contract.
//
// The session is stubbed at the supabase client, not through MSW: the route
// calls `supabase.auth.getSession()` directly, and mocking the transport would
// pin this test to gotrue's wire format instead of to the behaviour.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Route as MarketingIndexRoute } from "./index";

const stubSession = (signedIn: boolean) =>
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
        data: { session: signedIn ? ({ user: { id: "u_1" } } as never) : null },
        error: null,
    } as never);

/** Runs the shipped guard; returns where it redirected, or `null` if it let us through. */
const runGuard = async (): Promise<string | null> => {
    const beforeLoad = MarketingIndexRoute.options.beforeLoad as (
        opts: unknown
    ) => Promise<unknown>;

    try {
        await beforeLoad({ location: { href: "/" } });
        return null;
    } catch (thrown) {
        // The destination lives under `.options.to`, not `.to` — `redirect()`
        // returns a wrapper holding the navigation options it was given.
        if (isRedirect(thrown)) {
            return (thrown as { options?: { to?: string } }).options?.to ?? "(no destination)";
        }
        throw thrown;
    }
};

afterEach(() => vi.restoreAllMocks());

describe("/ (marketing index)", () => {
    it("sends a signed-in visitor to their dashboard", async () => {
        stubSession(true);
        expect(await runGuard()).toBe("/home");
    });

    it("leaves an anonymous visitor on the landing page", async () => {
        stubSession(false);
        expect(await runGuard()).toBeNull();
    });

    it("guards ONLY the index — not the whole marketing branch", async () => {
        // If this guard is ever moved up to `_marketing/route.tsx`, every future
        // public page under it disappears for signed-in users, and `/try` would
        // have gone the same way had it not been given its own layout. The
        // marketing layout must stay unguarded.
        const layout = await import("./route");
        expect(layout.Route.options.beforeLoad).toBeUndefined();
    });
});
