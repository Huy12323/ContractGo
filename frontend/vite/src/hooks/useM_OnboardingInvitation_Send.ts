import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_OnboardingInvitation_Send_Params = {
    organization_id: string;
    employee_email: string;
    entity_id: string;
    contract_template_id: string;
    department_ids: string[];
    prefilled_fields: Record<string, unknown>;
};

export const useM_OnboardingInvitation_Send = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_OnboardingInvitation_Send_Params) => {
            const sb_FunctionsEmployeeOnboardingSendInvitation_Invoke =
                await supabase.functions.invoke(
                    "employee-onboarding_send-invitation",
                    { body },
                );
            if (sb_FunctionsEmployeeOnboardingSendInvitation_Invoke.error) {
                // Surface the specific error message returned by the edge function
                let serverMessage = "Failed to send onboarding invitation";
                try {
                    const ctx = (
                        sb_FunctionsEmployeeOnboardingSendInvitation_Invoke.error as {
                            context?: { json?: () => Promise<{ error?: string }> };
                        }
                    ).context;
                    const body = await ctx?.json?.();
                    if (body?.error) serverMessage = body.error;
                } catch {
                    /* fall back to generic message */
                }
                throw new Error(serverMessage);
            }
            return sb_FunctionsEmployeeOnboardingSendInvitation_Invoke.data as {
                id: string;
                invitation_token: string;
                status: string;
            };
        },
        onSuccess: () => {
            message.success("Onboarding invitation sent");
            queryClient.invalidateQueries({
                queryKey: QueryKeys.onboardingInvitations.all(),
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to send onboarding invitation");
        },
    });

    return { mutation };
};
