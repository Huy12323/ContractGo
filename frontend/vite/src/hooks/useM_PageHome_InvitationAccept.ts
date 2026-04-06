import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_PageHome_InvitationAccept = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (invitationToken: string) => {
            const sb_RpcAcceptInvitation = await supabase.rpc("accept_invitation", {
                invitation_token: invitationToken,
            });
            if (sb_RpcAcceptInvitation.error) throw sb_RpcAcceptInvitation.error;
            return sb_RpcAcceptInvitation.data;
        },
        onSuccess: () => {
            message.success("Invitation accepted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() });
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to accept");
        },
    });

    return { mutation };
};
