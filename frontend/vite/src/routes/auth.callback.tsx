import { createFileRoute, redirect } from "@tanstack/react-router";
import { Flex, Spin } from "antd";
import { supabase } from "@/configs/supabase/config";
import { consumeOAuthRedirect } from "@/configs/auth/oauthRedirect";
import { finishOAuthTab, isOAuthTab } from "@/configs/auth/oauthTab";
import { BG_GRADIENT } from "@/providers/antd/Provider_ANTD";

// The return leg of the Google sign-in flow: Google -> GoTrue -> here, with an
// authorization `?code=` that supabase-js exchanges for a session during client
// init (`flowType: 'pkce'`, `detectSessionInUrl: true` in configs/supabase/config).
//
// Deliberately a flat route, NOT under `_auth`: that layout's beforeLoad bounces
// any session to `/`, which would fire the instant the exchange lands and throw
// away the stashed destination. This route owns where the user goes next.
//
// TWO SHAPES, one per tab. The sign-in button opens the consent screen in its own
// tab, so this normally runs in a tab whose whole job is to finish the exchange
// and get out of the way: it reports the outcome to the opener and closes, and the
// opener — which holds the destination in ITS sessionStorage — does the navigating.
// When a popup blocker refuses that tab the flow degrades to the original same-tab
// redirect, and this route redirects as it always did. `isOAuthTab()` is the only
// thing that separates the two.
export const Route = createFileRoute("/auth/callback")({
    beforeLoad: async () => {
        const params = new URLSearchParams(window.location.search);
        const providerError = params.get("error");
        const inOAuthTab = isOAuthTab();

        // The user pressed Cancel on the consent screen. Not a failure — send them
        // back to /login silently rather than accusing them of one.
        if (providerError === "access_denied") {
            if (inOAuthTab) return finishOAuthTab("cancelled");
            consumeOAuthRedirect();
            throw redirect({ to: "/login", search: {} });
        }

        // `getSession()` awaits the client's initialization, and the initialization
        // is what performs the code exchange — so this one call is the whole wait.
        // It resolves in the opened tab because the PKCE verifier the opener wrote
        // sits in localStorage, which both tabs share.
        const sb_Auth_GetSession = await supabase.auth.getSession();

        if (!sb_Auth_GetSession.data.session) {
            if (inOAuthTab) return finishOAuthTab("failed");
            consumeOAuthRedirect();
            throw redirect({ to: "/login", search: { error: "oauth_failed" } });
        }

        // CG-042. Copy the provider's profile picture into R2 so this account's
        // avatar is an object we hold, with a `files` row, like every other file in
        // the product since CG-037.
        //
        // AWAITED in the opened tab, fire-and-forget in the same tab. The reason
        // for the second — never make a user watch a third-party image fetch on the
        // critical path of a login — simply does not apply to a tab the user is not
        // looking at and that is about to close anyway. Awaiting there also fixes
        // what dropping it would cost: `window.close()` kills an in-flight request,
        // so an un-awaited call would be lost on EVERY sign-in rather than
        // occasionally, and the "picked up by the next sign-in" recovery below
        // would never come.
        if (inOAuthTab) {
            await supabase.functions.invoke("profile_avatar-mirror", { body: {} }).catch(() => {});
            return finishOAuthTab("success");
        }

        // The function is idempotent and cheap to re-enter, so a call lost to the
        // redirect below is picked up by the next sign-in — and the seeded
        // `avatar_url` renders in the meantime. `.catch` rather than nothing,
        // because an unhandled rejection from a promise nobody is holding surfaces
        // in the console as an error the user cannot act on. Failure here is not a
        // failed login.
        void supabase.functions.invoke("profile_avatar-mirror", { body: {} }).catch(() => {});

        // `destination` is a raw path carried through the OAuth round trip, not a
        // statically known route — same untyped-string `to` the login form already
        // uses for its `?redirect=`. From here the normal gates take over:
        // `_protected` still checks email verification and the CG-027 whitelist, so
        // a brand new Google account lands on /pending-access.
        throw redirect({ to: consumeOAuthRedirect() || "/home" });
    },
    // In the same-tab flow this is on screen only for the instant between mount and
    // the redirect throwing. In the opened tab it is what the user sees while the
    // exchange completes, just before the tab closes itself.
    component: () => (
        <Flex
            align="center"
            justify="center"
            style={{ height: "var(--app-vh)", background: BG_GRADIENT }}
        >
            <Spin size="large" />
        </Flex>
    ),
});
