import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import {
    Signing_Session_QueryKey,
    utils_Signing_AuthHeaders,
    utils_Signing_UnwrapError,
} from "@/hooks/useQ_Signing_Session";

export type UseM_Signing_Submit_Body = {
    access_token: string;
    field_values: Record<string, unknown>;
    signature_base64: string | null;
    capture_method: "drawn" | "typed" | "uploaded";
    /** Recorded as evidence — an electronic signature binds only if the signer
     *  agreed to sign electronically, so the server refuses without it. */
    consent_accepted: boolean;
};

export type UseM_Signing_Submit_Result = {
    status: "signed";
    /** True when this signer was the last one — the document is now burned. */
    completed: boolean;
    /**
     * A short-lived `view` credential for taking a copy of what was just signed.
     *
     * IT EXISTS BECAUSE THE ACTING TOKEN NO LONGER DOES. `signing_submit` consumes
     * the token this request arrived on, so from the response onward the signer's
     * own link authenticates nothing — including a download. This is the only
     * credential the receipt has.
     *
     * Nullable, and the receipt must cope: minting it is best-effort on the server
     * precisely so a token failure cannot fail a signature that was recorded.
     */
    download_token?: string | null;
};

/**
 * No `message.success` here, unlike the project's other mutations: the signer
 * surface answers with a full completion screen, and a toast on top of it reads
 * as an afterthought for what is the single most consequential action in the
 * product. Failures still surface — the page renders the thrown message inline
 * so it sits next to the fields it refers to.
 */
export const useM_Signing_Submit = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Signing_Submit_Body) => {
            // The session travels alongside the access token: the link says WHICH
            // signer, the session says it is really them, and `signing_submit`
            // refuses unless the two agree.
            const sb_FunctionsSigningSubmit_Invoke = await supabase.functions.invoke(
                "signing_submit",
                { body, headers: await utils_Signing_AuthHeaders() }
            );
            if (sb_FunctionsSigningSubmit_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsSigningSubmit_Invoke.error);
            }
            return sb_FunctionsSigningSubmit_Invoke.data as UseM_Signing_Submit_Result;
        },
        onSuccess: (_result, variables) => {
            // The session now reports the signer as `signed` and `can_sign` as
            // false; refetching keeps a reload or a back-navigation honest.
            queryClient.invalidateQueries({
                queryKey: Signing_Session_QueryKey(variables.access_token),
            });
        },
    });

    return { mutation };
};
