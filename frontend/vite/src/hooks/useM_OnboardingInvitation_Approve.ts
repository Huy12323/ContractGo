import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_OnboardingInvitation_Approve_Params = {
    contract_id: string;
    first_name: string;
    last_name: string;
    birthday?: string;
};

export const useM_OnboardingInvitation_Approve = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_OnboardingInvitation_Approve_Params) => {
            const sb_FunctionsEmployeeOnboardingApproveContract_Invoke =
                await supabase.functions.invoke(
                    "employee-onboarding_approve-contract",
                    { body },
                );
            if (sb_FunctionsEmployeeOnboardingApproveContract_Invoke.error)
                throw sb_FunctionsEmployeeOnboardingApproveContract_Invoke.error;
            return sb_FunctionsEmployeeOnboardingApproveContract_Invoke.data as {
                employee_id: string;
                contract_id: string;
                status: string;
            };
        },
        onSuccess: () => {
            message.success("Contract approved");
            queryClient.invalidateQueries({
                queryKey: QueryKeys.onboarding_invitations.all(),
            });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.contracts.all(),
            });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.departments.all(),
            });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to approve contract");
        },
    });

    return { mutation };
};
