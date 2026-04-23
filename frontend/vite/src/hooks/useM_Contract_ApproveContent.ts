import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Contract_ApproveContent_Params = {
    invitation_id: string;
};

export const useM_Contract_ApproveContent = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Contract_ApproveContent_Params) => {
            const sb_FunctionsEmployeeOnboardingApproveContent_Invoke =
                await supabase.functions.invoke(
                    "employee-onboarding_approve-content",
                    { body },
                );
            if (sb_FunctionsEmployeeOnboardingApproveContent_Invoke.error) {
                let serverMessage = "Failed to approve contract content";
                try {
                    const ctx = (
                        sb_FunctionsEmployeeOnboardingApproveContent_Invoke.error as {
                            context?: { json?: () => Promise<{ error?: string }> };
                        }
                    ).context;
                    const parsed = await ctx?.json?.();
                    if (parsed?.error) serverMessage = parsed.error;
                } catch {
                    /* fall back to generic */
                }
                throw new Error(serverMessage);
            }
            return sb_FunctionsEmployeeOnboardingApproveContent_Invoke.data as {
                invitation_id: string;
                status: string;
            };
        },
        onSuccess: () => {
            message.success("Content approved — ready for placement");
            queryClient.invalidateQueries({ queryKey: QueryKeys.onboarding_invitations.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contracts.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to approve content");
        },
    });

    return { mutation };
};
