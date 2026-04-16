import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_OnboardingInvitation_Delete_Params = {
    invitation_id: string;
};

export const useM_OnboardingInvitation_Delete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ invitation_id }: UseM_OnboardingInvitation_Delete_Params) => {
            // Only sent invitations can be deleted — anything past 'sent' has data tied to it
            const sb_FromOnboardingInvitations_Delete = await supabase
                .from("onboarding_invitations")
                .delete()
                .eq("id", invitation_id)
                .eq("status", "sent")
                .select("id")
                .maybeSingle();

            if (sb_FromOnboardingInvitations_Delete.error)
                throw sb_FromOnboardingInvitations_Delete.error;
            if (!sb_FromOnboardingInvitations_Delete.data)
                throw new Error(
                    "Invitation can only be deleted while it is in the 'sent' state.",
                );
            return sb_FromOnboardingInvitations_Delete.data;
        },
        onSuccess: () => {
            message.success("Invitation deleted");
            queryClient.invalidateQueries({
                queryKey: QueryKeys.onboarding_invitations.all(),
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to delete invitation");
        },
    });

    return { mutation };
};
