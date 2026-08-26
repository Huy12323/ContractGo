import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// A hard delete, not a status flip. `rejected` is the INVITEE's verb — it is
// what they set when they decline — and reusing it for the sender would make
// the People page unable to tell "they said no" from "we changed our mind".
export const useM_People_InvitationCancel = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (invitationId: string) => {
            const sb_FromInvitations_Delete = await supabase
                .from("invitations")
                .delete()
                .eq("id", invitationId);
            if (sb_FromInvitations_Delete.error) throw sb_FromInvitations_Delete.error;
        },
        onSuccess: () => {
            message.success("Invitation cancelled");
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.invitations.list(), organizationId],
            });
        },
        onError: () => {
            message.error("Failed to cancel invitation");
        },
    });

    return { mutation };
};
