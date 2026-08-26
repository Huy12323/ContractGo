import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { Utils_Query_InvalidateMembership } from "@/utils/query/Utils_Query_InvalidateMembership";

export type People_RoleChange_Role = "admin" | "member";

export type People_RoleChange_Variables = {
    userId: string;
    role: People_RoleChange_Role;
    /** Display name or email, used only for the toast. */
    label: string;
};

/**
 * Moves one person between the `admins` and `members` tiers.
 *
 * The whole operation lives in `set_organization_role` (CG-023) rather than
 * here: it is a DELETE from one table and an INSERT into another, and doing
 * that as two calls from the browser can strand somebody in neither. The RPC
 * also owns the rule that only the owner may demote an admin — the buttons in
 * the drawer mirror it, they do not enforce it.
 */
export const useM_People_RoleChange = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ userId, role }: People_RoleChange_Variables) => {
            const sb_RpcSetOrganizationRole = await supabase.rpc("set_organization_role", {
                org_id: organizationId,
                target_user_id: userId,
                new_role: role,
            });
            if (sb_RpcSetOrganizationRole.error) throw sb_RpcSetOrganizationRole.error;
            return sb_RpcSetOrganizationRole.data as { status: string; role: string };
        },
        onSuccess: (data, variables) => {
            if (data?.status === "unchanged") return;
            message.success(
                variables.role === "admin"
                    ? `${variables.label} is now an admin`
                    : `${variables.label} is now a member`
            );
            Utils_Query_InvalidateMembership(queryClient, organizationId);
        },
        // The RPC raises sentences meant to be read ("Only the owner can demote
        // an admin"), and PostgREST passes them through as `message`. Replacing
        // them with a generic string would throw away the only explanation of
        // why the action was refused.
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to change role");
        },
    });

    return { mutation };
};
