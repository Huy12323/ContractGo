import { useMutation } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { Store_Auth_Actions } from "@/stores/Store_Auth";

export type UseM_Profile_PasswordUpdate_Body = {
    email: string;
    currentPassword: string;
    newPassword: string;
};

/**
 * Thrown when the CURRENT password did not check out, so the form can put the
 * error on that field rather than in a toast the user has to map back to an input.
 */
export class Profile_CurrentPasswordError extends Error {
    constructor() {
        super("Current password is incorrect");
        this.name = "Profile_CurrentPasswordError";
    }
}

/**
 * Change the signed-in user's password.
 *
 * WHY THE RE-AUTHENTICATION STEP IS NOT OPTIONAL. `supabase.auth.updateUser`
 * accepts a new password on the strength of the SESSION alone — it never asks
 * for the old one. Exposed as-is behind an always-available account menu, that
 * turns any unattended logged-in tab into a full account takeover: a passer-by
 * sets a new password without knowing the old one and owns the account.
 *
 * So the current password is verified first, by spending it on a real sign-in.
 * `signInWithPassword` on the already-signed-in user is the check: it either
 * returns a fresh session for the same user (harmless — it replaces an equivalent
 * one) or it fails, which is the answer we wanted. There is no cheaper primitive
 * for this in the JS SDK.
 *
 * The two calls are NOT atomic, and the failure mode is the benign one: if
 * `updateUser` fails after the re-auth succeeded, nothing has changed and the
 * user retries.
 */
export const useM_Profile_PasswordUpdate = () => {
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({
            email,
            currentPassword,
            newPassword,
        }: UseM_Profile_PasswordUpdate_Body) => {
            const sb_Auth_SignInWithPassword = await supabase.auth.signInWithPassword({
                email,
                password: currentPassword,
            });
            if (sb_Auth_SignInWithPassword.error) throw new Profile_CurrentPasswordError();

            await Store_Auth_Actions.updatePassword(newPassword);
        },
        onSuccess: () => {
            message.success("Password updated");
        },
        onError: (err: Error) => {
            // The wrong-current-password case is surfaced on the field by the
            // caller, so it must not also shout in a toast.
            if (err instanceof Profile_CurrentPasswordError) return;
            console.error(err);
            message.error(err.message || "Could not update your password");
        },
    });

    return { mutation };
};
