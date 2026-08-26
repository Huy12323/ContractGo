import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { Utils_Query_InvalidateMembership } from "@/utils/query/Utils_Query_InvalidateMembership";

export type People_Remove_Variables = {
    userId: string;
    /** Display name or email, used only for the toast. */
    label: string;
};

export type People_Remove_Result = {
    status: string;
    role: string;
    /** True when the caller removed themselves — the page navigates away on it. */
    self: boolean;
};

/**
 * Removes one person from the organization, or the caller from it.
 *
 * "Remove them" and "leave" are the same RPC because they are the same
 * invariants: the owner can never be the target, the tier row goes, and the
 * accepted invitation goes with it so the address can be invited again. Only
 * the permission question differs, and the RPC answers it.
 */
export const useM_People_Remove = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ userId }: People_Remove_Variables) => {
            const sb_RpcRemoveFromOrganization = await supabase.rpc("remove_from_organization", {
                org_id: organizationId,
                target_user_id: userId,
            });
            if (sb_RpcRemoveFromOrganization.error) throw sb_RpcRemoveFromOrganization.error;
            return sb_RpcRemoveFromOrganization.data as unknown as People_Remove_Result;
        },
        onSuccess: (data, variables) => {
            message.success(
                data?.self ? "You left the organization" : `${variables.label} was removed`
            );
            Utils_Query_InvalidateMembership(queryClient, organizationId);
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to remove");
        },
    });

    return { mutation };
};
