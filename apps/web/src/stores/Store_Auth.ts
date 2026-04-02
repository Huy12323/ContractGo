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
                        window.location.href = "/login";
                    } else {
                        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
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
        const sb_Auth_SignOut = await supabase.auth.signOut();
        if (sb_Auth_SignOut.error) {
            userInitiatedSignOut = false;
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
