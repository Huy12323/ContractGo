import { Store, useStore } from "@tanstack/react-store";
import { supabase } from "@/configs/supabase/config";
import { queryClient } from "@/lib/query-client";
import type { User, Session } from "@supabase/supabase-js";

class State_Auth {
    user: User | null = null;
    session: Session | null = null;
    loading: boolean = true;
}

export const Store_Auth = new Store(new State_Auth());

// Selectors
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
        const sb_Auth_SignInWithPassword = await supabase.auth.signInWithPassword({ email, password });
        if (sb_Auth_SignInWithPassword.error) throw sb_Auth_SignInWithPassword.error;
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
