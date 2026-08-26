// Cross-tab handshake for the Google sign-in flow.
//
// The consent screen opens in a SEPARATE tab (App_GoogleSignInButton), so the tab
// that completes the OAuth round trip is not the tab the user started in. That tab
// has no reason to stick around — it exists only to hold the provider's redirect —
// so it reports the outcome back through here and closes itself, and the ORIGINAL
// tab is the one that navigates into the app.
//
// Which tab owns what, since the split is easy to get wrong:
//   - the PKCE code_verifier lives in localStorage (supabase-js default storage),
//     so the opened tab can perform the exchange even though the opener started it;
//   - the post-login destination lives in the OPENER's sessionStorage
//     (`oauthRedirect`), which the opened tab cannot see and must not consume.
//
// Why a postMessage instead of leaning on supabase-js to sync the session across
// tabs: the opener finishes with a hard `window.location.href`, so it re-reads the
// session from localStorage as it boots. That behaves identically on every
// supabase-js version and needs no BroadcastChannel.

export type OAuthTabStatus = "success" | "failed" | "cancelled";

const MESSAGE_SOURCE = "contractgo-oauth-tab";

interface OAuthTabMessage {
    source: typeof MESSAGE_SOURCE;
    status: OAuthTabStatus;
}

/**
 * True in the tab `window.open` created, false in the same-tab fallback taken when
 * a popup blocker refuses it. `window.opener !== window` guards the case where the
 * property is self-referential rather than null.
 */
export const isOAuthTab = () => {
    try {
        return !!window.opener && window.opener !== window;
    } catch {
        // Cross-origin opener access throws rather than returning null.
        return false;
    }
};

/** Called from /auth/callback in the opened tab: report the outcome, then close. */
export const finishOAuthTab = (status: OAuthTabStatus) => {
    try {
        const message: OAuthTabMessage = { source: MESSAGE_SOURCE, status };
        // Targeted at our own origin, never "*" — the message says a sign-in
        // succeeded, which is not something to broadcast to whatever is listening.
        window.opener?.postMessage(message, window.location.origin);
    } catch {
        // Opener already gone. Closing is still the right move.
    }
    window.close();
};

/**
 * Called from the opener. Returns an unsubscribe, so it drops straight into a
 * `useEffect` cleanup.
 */
export const onOAuthTabFinish = (handler: (status: OAuthTabStatus) => void) => {
    const listener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as OAuthTabMessage | null;
        if (data?.source !== MESSAGE_SOURCE) return;
        handler(data.status);
    };

    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
};
