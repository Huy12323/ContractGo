import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Signatures_SetDefault_Params = {
    signature_id: string;
};

/**
 * Promotes one saved signature to the user's default (CG-029).
 *
 * AN RPC, NOT TWO UPDATES. `user_signatures_one_default` is a partial unique
 * index, and a partial index cannot be a deferrable constraint — so it is checked
 * row by row. Clearing the old default and setting the new one from the client
 * would be two round trips with a window in between where either zero or two rows
 * claim the default, and a failure between them would strand the library with no
 * default at all. `set_default_signature()` does both in one transaction.
 *
 * It is SECURITY INVOKER, so the RLS policies are still the authority — the RPC
 * exists for atomicity, not to escalate.
 */
export const useM_Signatures_SetDefault = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ signature_id }: UseM_Signatures_SetDefault_Params): Promise<void> => {
            const sb_RpcSetDefaultSignature = await supabase.rpc("set_default_signature", {
                p_signature_id: signature_id,
            });
            if (sb_RpcSetDefaultSignature.error) throw sb_RpcSetDefaultSignature.error;
        },
        onSuccess: () => {
            message.success("Default signature updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.user_signatures.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Could not set the default signature");
        },
    });

    return { mutation };
};
