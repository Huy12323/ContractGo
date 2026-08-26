import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * Answers the one-time passcode — CG-031.
 *
 * Sibling of `useM_Signing_OtpSend`, and the same two omissions apply: no auth
 * headers (there is no account in this mode) and no query invalidation (the
 * signing session query burns a token use per fetch, so the verified state is
 * held locally and re-checked by `signing_submit` at the commit).
 *
 * A WRONG CODE ARRIVES AS A THROWN ERROR, carrying `attempts_remaining` on it.
 * That is deliberate rather than awkward: the gate has to render "not right —
 * 3 tries left" in the same place it renders every other refusal, and treating a
 * wrong guess as a successful call with a falsy field would give it two code
 * paths for one outcome.
 */
export type UseM_Signing_OtpVerify_Body = {
    access_token: string;
    code: string;
};

export type UseM_Signing_OtpVerify_Result = {
    status: "verified";
};

export const useM_Signing_OtpVerify = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_OtpVerify_Body) => {
            const sb_FunctionsSigningOtpVerify_Invoke = await supabase.functions.invoke(
                "signing_otp_verify",
                { body }
            );
            if (sb_FunctionsSigningOtpVerify_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningOtpVerify_Invoke.error);
            }
            return sb_FunctionsSigningOtpVerify_Invoke.data as UseM_Signing_OtpVerify_Result;
        },
    });

    return { mutation };
};
