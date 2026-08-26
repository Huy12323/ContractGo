import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";

/**
 * Switches a key off, permanently and immediately.
 *
 * NOT A DELETE. `api_key_revoke` stamps `revoked_at`; the row survives, and so
 * does the answer to "which key sent this document?" — the audit chain records
 * `api_key_id` and `api_key_name` on every entry an integration produced
 * (CG-044, Decision 3). Deleting the row would leave those entries naming a key
 * nobody can look up, which is exactly the question someone asks six months
 * later when a contract is disputed.
 *
 * IT TAKES EFFECT ON THE NEXT REQUEST, with no cache to wait for.
 * `api_key_resolve` asserts `revoked_at IS NULL` inside the single UPDATE that
 * authenticates the call, so there is no window in which a revoked key still
 * works.
 *
 * Explicit invalidation only — see `useM_ApiKeys_Issue` for why there is no
 * realtime half here.
 */
export const useM_ApiKeys_Revoke = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["api_keys", "revoke"],
        mutationFn: async (apiKeyId: string) => {
            const sb_RpcApiKeyRevoke = await supabase.rpc("api_key_revoke", {
                p_api_key_id: apiKeyId,
            });
            if (sb_RpcApiKeyRevoke.error) throw sb_RpcApiKeyRevoke.error;

            // ⚠ TWO DIFFERENT REFUSALS, AND THE RPC SPELLS THEM DIFFERENTLY.
            // A key that is not this caller's to touch RAISES — deliberately
            // with the same "unknown api key" wording whether it does not exist
            // or belongs to another organization, so the endpoint is not an
            // oracle. That path is handled by `onError` above.
            //
            // FALSE is the other case: the row was found and nothing was
            // updated, i.e. it was already revoked. Surfaced rather than
            // swallowed, because a silent no-op on a revoke reads as success
            // and the admin walks away believing a live credential is dead.
            if (sb_RpcApiKeyRevoke.data !== true) {
                throw new Error("That key was already revoked.");
            }
        },
        onSuccess: () => {
            message.success("Key revoked. Any integration using it will stop working now.");
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.api_keys.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to revoke the key"));
        },
    });

    return { mutation };
};
