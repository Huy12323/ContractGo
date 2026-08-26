import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { Utils_Query_InvalidateMembership } from "@/utils/query/Utils_Query_InvalidateMembership";

export type People_OwnershipTransfer_Variables = {
    userId: string;
    /** Display name or email, used only for the toast. */
    label: string;
};

/**
 * Hands the organization to somebody already in it.
 *
 * One-way and unconfirmable from this side: after it succeeds the caller is an
 * admin and cannot take it back. That is why the drawer wraps it in a
 * Popconfirm naming the person, and why the RPC refuses any target who is not
 * already a member — a mistyped id would otherwise be unrecoverable.
 */
export const useM_People_OwnershipTransfer = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ userId }: People_OwnershipTransfer_Variables) => {
            const sb_RpcTransferOrganizationOwnership = await supabase.rpc(
                "transfer_organization_ownership",
                { org_id: organizationId, new_owner_user_id: userId }
            );
            if (sb_RpcTransferOrganizationOwnership.error)
                throw sb_RpcTransferOrganizationOwnership.error;
            return sb_RpcTransferOrganizationOwnership.data as { status: string };
        },
        onSuccess: (data, variables) => {
            if (data?.status === "unchanged") return;
            message.success(`${variables.label} is now the owner`);
            Utils_Query_InvalidateMembership(queryClient, organizationId);
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to transfer ownership");
        },
    });

    return { mutation };
};
