// Shared sessionStorage key for the post-OAuth redirect destination.
// Written by Store_Auth_Actions.signInWithGoogle before handing the browser to
// the provider; read by /auth/callback once the session exists.
//
// Why not carry it on the URL: the destination would have to survive
// app -> Google -> GoTrue -> app, and GoTrue matches `redirect_to` against its
// allow-list. Keeping the callback URL constant keeps that list a fixed set of
// exact URLs instead of a wildcard, and the destination never leaves this origin.
//
// sessionStorage, not localStorage (which `postVerifyRedirect` uses), even though
// the consent screen now runs in a tab of its own. The destination belongs to the
// tab the user clicked in, and that tab is the one that consumes it and navigates
// — the opened tab reports its outcome and closes without ever reading this (see
// `oauthTab`). Keeping it per-tab means a stale value cannot leak into a later
// session, and two sign-ins started in two tabs cannot land on each other's page.
//
// A tab created by `window.open` does inherit a COPY of this storage, so the value
// may be visible there. Nothing reads it there; the copy is a dead end that
// disappears with the tab.
export const OAUTH_REDIRECT_KEY = "auth_redirect_after_oauth";

export const stashOAuthRedirect = (destination?: string) => {
    if (destination) sessionStorage.setItem(OAUTH_REDIRECT_KEY, destination);
    else sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
};

export const consumeOAuthRedirect = (): string | null => {
    const value = sessionStorage.getItem(OAUTH_REDIRECT_KEY);
    if (value) sessionStorage.removeItem(OAUTH_REDIRECT_KEY);
    return value;
};
