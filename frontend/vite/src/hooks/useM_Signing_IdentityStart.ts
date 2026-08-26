import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * [ekyc] Opens a government-ID identity check for the signer — CG-033.
 *
 * Shaped exactly like `useM_Signing_OtpSend`, including both of its omissions:
 *
 * NO AUTH HEADERS. This is the path for a recipient who has no account, so the
 * token in the body is the whole of the credential.
 *
 * NO QUERY INVALIDATION. Refetching the signing session would burn a use of the
 * signer's link on every poll; `Page_Sign` holds the outcome locally for the
 * length of the ceremony, and `signing_submit` re-checks at the commit — which
 * is what makes holding it locally safe.
 *
 * MUST BE CALLED FROM AN EXPLICIT BUTTON PRESS, never on mount. Same rule as the
 * passcode, and the reason survives in a modified form: nothing is emailed here,
 * but a mail scanner pre-fetching the link must not START a check — it would burn
 * one of the signer's five hourly attempts, and with a real vendor it would spend
 * the sender's money, for a robot.
 */
export type UseM_Signing_IdentityStart_Body = {
    access_token: string;
};

export type UseM_Signing_IdentityStart_Result = {
    /** `approved` is the already-passed short circuit, not a new verdict. */
    status: "pending" | "approved" | "cooldown";
    check_id?: string;
    expires_at?: string;
    /** Where the provider wants the signer to go. Built SERVER-side. */
    redirect_url?: string;
    resend_after_seconds?: number;
    retry_after_seconds?: number;
};

export const useM_Signing_IdentityStart = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_IdentityStart_Body) => {
            const sb_FunctionsSigningIdentityStart_Invoke = await supabase.functions.invoke(
                "signing_identity_start",
                { body }
            );
            if (sb_FunctionsSigningIdentityStart_Invoke.error) {
                // A 429 cooldown arrives here as an error because it is a
                // non-2xx. The gate reads `retry_after_seconds` off the unwrapped
                // body and starts a countdown rather than reporting a failure.
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsSigningIdentityStart_Invoke.error
                );
            }
            return sb_FunctionsSigningIdentityStart_Invoke.data as UseM_Signing_IdentityStart_Result;
        },
    });

    return { mutation };
};
