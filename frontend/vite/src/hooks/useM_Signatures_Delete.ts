import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Signatures_Delete_Params = {
    signature_id: string;
};

/**
 * Removes a saved signature and its stored object (CG-029).
 *
 * Goes through `user_signatures_delete` rather than a plain SDK delete, even
 * though RLS would happily authorize the row delete: the R2 object has to go with
 * it, and the browser holds no credential that can remove one. A client-side
 * delete would silently leave the bytes behind on every removal.
 *
 * Deleting the default also promotes a survivor — server-side, so the promotion
 * cannot be lost to a closed tab. See the edge function.
 */
export const useM_Signatures_Delete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ signature_id }: UseM_Signatures_Delete_Params): Promise<void> => {
            const sb_FunctionsUserSignaturesDelete_Invoke = await supabase.functions.invoke(
                "user_signatures_delete",
                { body: { signature_id } }
            );
            if (sb_FunctionsUserSignaturesDelete_Invoke.error) {
                let serverMessage = "Failed to delete signature";
                try {
                    const ctx = (
                        sb_FunctionsUserSignaturesDelete_Invoke.error as {
                            context?: { json?: () => Promise<{ error?: string }> };
                        }
                    ).context;
                    const body = await ctx?.json?.();
                    if (body?.error) serverMessage = body.error;
                } catch {
                    /* fall back to generic message */
                }
                throw new Error(serverMessage);
            }
        },
        onSuccess: () => {
            message.success("Signature deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.user_signatures.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to delete signature");
        },
    });

    return { mutation };
};
