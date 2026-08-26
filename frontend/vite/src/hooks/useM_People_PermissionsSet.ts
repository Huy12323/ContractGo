import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { Utils_Query_InvalidateMembership } from "@/utils/query/Utils_Query_InvalidateMembership";

export type People_Permissions = {
    canManageTemplates: boolean;
    canSendDocuments: boolean;
};

export type People_PermissionsSet_Variables = People_Permissions & {
    userId: string;
    /** Display name or email, used only for the toast. */
    label: string;
};

/**
 * Sets a member's two CG-027 permission flags.
 *
 * Both flags go on every call because `set_member_permissions` takes both: a
 * partial update would need a three-valued argument to tell "leave alone" from
 * "revoke", and the drawer that calls this always holds the current value of
 * each switch anyway.
 *
 * The RPC — not a direct UPDATE — because `members` has no policy admitting an
 * admin to somebody else's row, and the one that would grant it would also let a
 * member edit their own flags. That is the escalation the permission exists to
 * prevent, so the check lives inside a SECURITY DEFINER function where the
 * caller cannot be the subject.
 */
export const useM_People_PermissionsSet = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({
            userId,
            canManageTemplates,
            canSendDocuments,
        }: People_PermissionsSet_Variables) => {
            const sb_RpcSetMemberPermissions = await supabase.rpc("set_member_permissions", {
                org_id: organizationId,
                target_user_id: userId,
                p_can_manage_templates: canManageTemplates,
                p_can_send_documents: canSendDocuments,
            });
            if (sb_RpcSetMemberPermissions.error) throw sb_RpcSetMemberPermissions.error;
            return sb_RpcSetMemberPermissions.data as {
                status: string;
                can_manage_templates: boolean;
                can_send_documents: boolean;
            };
        },
        onSuccess: (_data, variables) => {
            message.success(`Updated ${variables.label}'s permissions`);
            Utils_Query_InvalidateMembership(queryClient, organizationId);
        },
        // Same contract as the other membership mutations: the RPC raises
        // sentences meant to be read ("Admins and owners already have every
        // permission") and PostgREST passes them through as `message`.
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to update permissions");
        },
    });

    return { mutation };
};
