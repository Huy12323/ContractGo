import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Onboarding_SubmitContract_Body = {
    invitation_token: string;
    field_values: Record<string, unknown>;
    signature_base64: string;
};

export const useM_Onboarding_SubmitContract = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Onboarding_SubmitContract_Body) => {
            const sb_FunctionsEmployeeOnboardingSubmitContract_Invoke =
                await supabase.functions.invoke(
                    "employee-onboarding_submit-contract",
                    { body },
                );
            if (sb_FunctionsEmployeeOnboardingSubmitContract_Invoke.error)
                throw sb_FunctionsEmployeeOnboardingSubmitContract_Invoke.error;
            return sb_FunctionsEmployeeOnboardingSubmitContract_Invoke.data as {
                contract_id: string;
                status: string;
            };
        },
        onSuccess: () => {
            message.success("Contract submitted for review");
            queryClient.invalidateQueries({
                queryKey: QueryKeys.onboardingInvitations.all(),
            });
        },
        onError: (err) => {
            console.error(err);
            message.error(
                err instanceof Error ? err.message : "Failed to submit contract",
            );
        },
    });

    return { mutation };
};
