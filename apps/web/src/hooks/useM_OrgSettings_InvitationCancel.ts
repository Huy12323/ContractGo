import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_OrgSettings_InvitationCancel = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (invitationId: string) => {
            const sb_FromOrgAdminInvitations_Delete = await supabase
                .from("org_admin_invitations")
                .delete()
                .eq("id", invitationId);
            if (sb_FromOrgAdminInvitations_Delete.error) throw sb_FromOrgAdminInvitations_Delete.error;
        },
        onSuccess: () => {
            message.success("Invitation cancelled");
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.organizations.record(organizationId), "invitations"],
            });
        },
        onError: () => {
            message.error("Failed to cancel invitation");
        },
    });

    return { mutation };
};
