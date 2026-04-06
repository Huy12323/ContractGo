import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_PageHome_InvitationReject = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (invitationId: string) => {
            const sb_FromAdminInvitations_Update = await supabase
                .from("admin_invitations")
                .update({ status: "rejected" })
                .eq("id", invitationId);
            if (sb_FromAdminInvitations_Update.error) throw sb_FromAdminInvitations_Update.error;
        },
        onSuccess: () => {
            message.success("Invitation declined");
            queryClient.invalidateQueries({ queryKey: QueryKeys.adminInvitations.all() });
        },
        onError: () => {
            message.error("Failed to decline invitation");
        },
    });

    return { mutation };
};
