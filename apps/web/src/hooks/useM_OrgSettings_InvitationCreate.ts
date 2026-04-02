import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_OrgSettings_InvitationCreate = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (email: string) => {
            const sb_FunctionsInvokeSendAdminInvitation = await supabase.functions.invoke("send-admin-invitation", {
                body: { organization_id: organizationId, email },
            });
            if (sb_FunctionsInvokeSendAdminInvitation.error) throw sb_FunctionsInvokeSendAdminInvitation.error;
            if (sb_FunctionsInvokeSendAdminInvitation.data?.error) throw new Error(sb_FunctionsInvokeSendAdminInvitation.data.error);
            return sb_FunctionsInvokeSendAdminInvitation.data;
        },
        onSuccess: () => {
            message.success("Invitation sent");
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.organizations.record(organizationId), "invitations"],
            });
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to send invitation");
        },
    });

    return { mutation };
};
