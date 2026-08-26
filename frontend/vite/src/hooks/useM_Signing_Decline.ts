import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import {
    Signing_Session_QueryKey,
    utils_Signing_AuthHeaders,
    utils_Signing_UnwrapError,
} from "@/hooks/useQ_Signing_Session";

export type UseM_Signing_Decline_Body = {
    access_token: string;
    /** Required by the server, and it means it — the reason is hashed into the
     *  `signer_declined` audit entry and quoted verbatim to the sender. */
    reason: string;
};

export type UseM_Signing_Decline_Result = {
    status: "declined";
};

/**
 * No `message.success`, matching `useM_Signing_Submit`: the page answers with a
 * full-screen result, and a toast congratulating someone on refusing to sign a
 * contract reads badly. Failures surface inline, next to the confirm action.
 */
export const useM_Signing_Decline = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_Decline_Body) => {
            // Account-gated exactly like the submit — a decline closes the
            // document for every party, so it is the last action that should be
            // available to anyone who merely holds the link.
            const sb_FunctionsSigningDecline_Invoke = await supabase.functions.invoke(
                "signing_decline",
                { body, headers: await utils_Signing_AuthHeaders() }
            );
            if (sb_FunctionsSigningDecline_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningDecline_Invoke.error);
            }
            return sb_FunctionsSigningDecline_Invoke.data as UseM_Signing_Decline_Result;
        },
        onSuccess: (_result, variables) => {
            // The session now reports the signer as `declined` and `can_sign` as
            // false. The token is also consumed, so this refetch is the last one
            // that will succeed — which is exactly what should be reflected if
            // the signer reloads.
            queryClient.invalidateQueries({
                queryKey: Signing_Session_QueryKey(variables.access_token),
            });
        },
    });

    return { mutation };
};
