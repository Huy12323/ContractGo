import { Store, useStore } from "@tanstack/react-store";
import { supabase } from "@/configs/supabase/config";
import { queryClient } from "@/configs/query/config";
import { stashOAuthRedirect } from "@/configs/auth/oauthRedirect";
import type { User, Session } from "@supabase/supabase-js";

class State_Auth {
    user: User | null = null;
    session: Session | null = null;
    loading: boolean = true;
}

export const Store_Auth = new Store(new State_Auth());

// Selectors
// `user` and `session` are objects, and Supabase hands back a freshly-parsed one
// on every TOKEN_REFRESHED — so a reference compare would re-render every
// consumer each refresh even though nothing they read (id, email, access_token)
// changed. `useStore` already compares the SELECTED slice with `shallow`
// unconditionally (`react-store@0.7.7` passes it to
// `useSyncExternalStoreWithSelector` itself), so that is handled here with no
// options argument — the two-parameter signature is the whole API, and passing
// a third `{ equal: shallow }` was both a type error and a no-op.
export const useStore_Auth_User = () => useStore(Store_Auth, (s) => s.user);
export const useStore_Auth_Session = () => useStore(Store_Auth, (s) => s.session);
export const useStore_Auth_Loading = () => useStore(Store_Auth, (s) => s.loading);

let userInitiatedSignOut = false;
let userInitiatedSignOutDestination: string | null = null;

// Actions
export const Store_Auth_Actions = {
    initAuth: () => {
        supabase.auth.onAuthStateChange((event, session) => {
            switch (event) {
                case "INITIAL_SESSION":
                    Store_Auth.setState((s) => ({
                        ...s,
                        user: session?.user ?? null,
                        session,
                        loading: false,
                    }));
                    break;

                case "SIGNED_IN":
                case "TOKEN_REFRESHED":
                    Store_Auth.setState((s) => ({
                        ...s,
                        user: session?.user ?? null,
                        session,
                    }));
                    break;

                case "SIGNED_OUT":
                    queryClient.clear();
                    if (userInitiatedSignOut) {
                        userInitiatedSignOut = false;
                        // If the caller specified a destination to return to after re-login,
                        // honor it. Otherwise land on /login with no redirect (the plain
                        // sign-out-from-nav case).
                        if (userInitiatedSignOutDestination) {
                            const dest = userInitiatedSignOutDestination;
                            userInitiatedSignOutDestination = null;
                            window.location.href = `/login?redirect=${encodeURIComponent(dest)}`;
                        } else {
                            window.location.href = "/login";
                        }
                    } else {
                        // Session expired or external sign-out — try to bring the user back
                        // to where they were.
                        const currentPath = window.location.pathname + window.location.search;
                        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
                    }
                    return;
            }
        });
    },

    signInWithPassword: async (email: string, password: string) => {
        const sb_Auth_SignInWithPassword = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (sb_Auth_SignInWithPassword.error) throw sb_Auth_SignInWithPassword.error;
    },

    /**
     * Hand the browser to Google's consent screen. There is still no success path
     * to handle here: this returns once the flow has been *started*, never once it
     * has finished. The session materializes on the way back at `/auth/callback`,
     * and `initAuth`'s SIGNED_IN case picks it up unchanged.
     *
     * `authTab` is a tab the CALLER already opened — it has to be opened
     * synchronously inside the click handler to survive a popup blocker, which is
     * why this function cannot open it itself. Given one, the consent screen is
     * pointed at that tab and the current page stays put; the opened tab reports
     * back through `configs/auth/oauthTab` and closes. Given `null` or nothing,
     * this falls back to the original same-tab full-page redirect.
     *
     * Serves both sign-in and sign-up: Google does not distinguish them, and
     * neither does GoTrue — an unknown email creates the account, a known one
     * signs into it (linking the identity onto the existing row when the address
     * is already verified there).
     */
    signInWithGoogle: async (redirectTo?: string, authTab?: Window | null) => {
        stashOAuthRedirect(redirectTo);
        const sb_Auth_SignInWithOAuth = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
                // `select_account` on purpose: without it Google silently reuses
                // whichever account the browser is already signed into, which is
                // the wrong default on a shared machine and makes "sign in as
                // someone else" impossible without leaving the app.
                queryParams: { prompt: "select_account" },
                // The caller opened a tab for the consent screen, so supabase-js
                // must not navigate THIS one; it hands back the provider URL and
                // the tab is pointed at it below. Absent a tab (a popup blocker
                // refused it) the default full-page redirect is the fallback, and
                // the flow is exactly what it was before tabs entered the picture.
                skipBrowserRedirect: !!authTab,
            },
        });
        if (sb_Auth_SignInWithOAuth.error) {
            stashOAuthRedirect(undefined);
            throw sb_Auth_SignInWithOAuth.error;
        }

        if (authTab) {
            const providerUrl = sb_Auth_SignInWithOAuth.data.url;
            // Typed `string | null`. Under skipBrowserRedirect it is the entire
            // result, so a null here would leave a blank tab open and no flow
            // running — worth an explicit failure rather than a silent no-op.
            if (!providerUrl) {
                stashOAuthRedirect(undefined);
                throw new Error("Google did not return a sign-in URL.");
            }
            authTab.location.href = providerUrl;
        }
    },

    signUp: async (email: string, password: string, fullName: string) => {
        const sb_Auth_SignUp = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
        });
        if (sb_Auth_SignUp.error) throw sb_Auth_SignUp.error;
    },

    signOut: async () => {
        userInitiatedSignOut = true;
        userInitiatedSignOutDestination = null;
        const sb_Auth_SignOut = await supabase.auth.signOut();
        if (sb_Auth_SignOut.error) {
            userInitiatedSignOut = false;
            throw sb_Auth_SignOut.error;
        }
    },

    /**
     * Sign out the current user and, after returning to /login, preserve a
     * destination path so that successfully signing in as a different user
     * lands them on that path. Used by wrong-account screens (e.g. an onboarding
     * invitation link opened while signed in as the wrong email).
     */
    signOutAndRedirect: async (destination: string) => {
        userInitiatedSignOut = true;
        userInitiatedSignOutDestination = destination;
        const sb_Auth_SignOut = await supabase.auth.signOut();
        if (sb_Auth_SignOut.error) {
            userInitiatedSignOut = false;
            userInitiatedSignOutDestination = null;
            throw sb_Auth_SignOut.error;
        }
    },

    resendVerification: async (email: string) => {
        const sb_Auth_Resend = await supabase.auth.resend({ type: "signup", email });
        if (sb_Auth_Resend.error) throw sb_Auth_Resend.error;
    },

    resetPasswordForEmail: async (email: string) => {
        const sb_Auth_ResetPasswordForEmail = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        if (sb_Auth_ResetPasswordForEmail.error) throw sb_Auth_ResetPasswordForEmail.error;
    },

    updatePassword: async (password: string) => {
        const sb_Auth_UpdateUser = await supabase.auth.updateUser({ password });
        if (sb_Auth_UpdateUser.error) throw sb_Auth_UpdateUser.error;
    },

    verifyRecoveryOtp: async (email: string, token: string) => {
        const sb_Auth_VerifyOtp = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
        if (sb_Auth_VerifyOtp.error) throw sb_Auth_VerifyOtp.error;
    },
};
