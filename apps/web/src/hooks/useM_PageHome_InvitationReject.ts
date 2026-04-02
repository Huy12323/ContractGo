import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_PageHome_InvitationReject = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (invitationId: string) => {
            const sb_FromOrgAdminInvitations_Update = await supabase
                .from("org_admin_invitations")
                .update({ status: "rejected" })
                .eq("id", invitationId);
            if (sb_FromOrgAdminInvitations_Update.error) throw sb_FromOrgAdminInvitations_Update.error;
        },
        onSuccess: () => {
            message.success("Invitation declined");
            queryClient.invalidateQueries({ queryKey: QueryKeys.orgAdminInvitations.all() });
        },
        onError: () => {
            message.error("Failed to decline invitation");
        },
    });

    return { mutation };
};
