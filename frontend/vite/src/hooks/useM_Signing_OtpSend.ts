import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * Asks for a one-time passcode to be emailed to the signer — CG-031.
 *
 * NO AUTH HEADERS, unlike `useM_Signing_Submit`. This is the path for a
 * recipient who has no account and never will, so the token in the body is the
 * whole of the credential. Sending a session here would not be wrong, merely
 * meaningless — `signing_otp_send` does not look at one.
 *
 * NO QUERY INVALIDATION EITHER, and that is the more interesting omission. The
 * obvious move would be to refetch the signing session so `otp_verified` is
 * fresh, but that query is configured `retry: false` with no refetch-on-focus
 * because every fetch of it burns a use of the signer's link. The verified
 * state is therefore held locally by `Page_Sign` for the length of the ceremony,
 * and the only authority that matters is `signing_submit`'s own re-check at the
 * moment of the commit.
 *
 * MUST BE CALLED FROM AN EXPLICIT BUTTON PRESS, never on mount. Corporate mail
 * scanners pre-fetch links, so a send-on-open would turn every scanner and every
 * page reload into an email to the counterparty.
 */
export type UseM_Signing_OtpSend_Body = {
    access_token: string;
};

export type UseM_Signing_OtpSend_Result = {
    status: "sent" | "cooldown";
    expires_at?: string;
    /** Seconds until the resend button is allowed again — server-owned. */
    resend_after_seconds?: number;
    retry_after_seconds?: number;
};

export const useM_Signing_OtpSend = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_OtpSend_Body) => {
            const sb_FunctionsSigningOtpSend_Invoke = await supabase.functions.invoke(
                "signing_otp_send",
                { body }
            );
            if (sb_FunctionsSigningOtpSend_Invoke.error) {
                // A 429 cooldown arrives here as an error, because it is a
                // non-2xx. The gate reads `retry_after_seconds` off the unwrapped
                // body to start its countdown rather than treating it as a
                // failure — being told to wait is a normal outcome of pressing
                // "resend" twice.
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningOtpSend_Invoke.error);
            }
            return sb_FunctionsSigningOtpSend_Invoke.data as UseM_Signing_OtpSend_Result;
        },
    });

    return { mutation };
};
