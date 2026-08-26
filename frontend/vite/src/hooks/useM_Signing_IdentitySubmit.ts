import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

/**
 * [ekyc] Reads the identity provider's verdict back — CG-033.
 *
 * The twin of `useM_Signing_IdentityStart`, and the same two omissions apply for
 * the same reasons — with the second sharpened: this call is POLLED while the
 * provider works, so invalidating the signing session here would burn a use of
 * the signer's link every few seconds.
 *
 * IT IS SAFE TO CALL REPEATEDLY. `signer_identity_record_verdict` matches on
 * `status = 'pending'`, so the verdict is write-once — a second call with a
 * different answer cannot turn a rejection into an approval — and a `pending`
 * result writes nothing and chains nothing at all.
 */
export type UseM_Signing_IdentitySubmit_Body = {
    access_token: string;
};

export type UseM_Signing_IdentitySubmit_Result = {
    status: "not_started" | "pending" | "approved" | "rejected" | "expired";
    check_id?: string;
    /** Only on a rejection, and it is the provider's truncated text. The
     *  confidence SCORE never leaves the server. */
    reason?: string;
};

export const useM_Signing_IdentitySubmit = () => {
    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_IdentitySubmit_Body) => {
            const sb_FunctionsSigningIdentityVerify_Invoke = await supabase.functions.invoke(
                "signing_identity_verify",
                { body }
            );
            if (sb_FunctionsSigningIdentityVerify_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsSigningIdentityVerify_Invoke.error
                );
            }
            return sb_FunctionsSigningIdentityVerify_Invoke.data as UseM_Signing_IdentitySubmit_Result;
        },
    });

    return { mutation };
};
