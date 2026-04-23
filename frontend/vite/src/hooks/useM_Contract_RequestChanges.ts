import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Contract_RequestChanges_Params = {
    invitation_id: string;
    comment_body: string;
};

export const useM_Contract_RequestChanges = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_Contract_RequestChanges_Params) => {
            const sb_FunctionsEmployeeOnboardingRequestChanges_Invoke =
                await supabase.functions.invoke(
                    "employee-onboarding_request-changes",
                    { body },
                );
            if (sb_FunctionsEmployeeOnboardingRequestChanges_Invoke.error) {
                let serverMessage = "Failed to request changes";
                try {
                    const ctx = (
                        sb_FunctionsEmployeeOnboardingRequestChanges_Invoke.error as {
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
            return sb_FunctionsEmployeeOnboardingRequestChanges_Invoke.data as {
                contract_id: string;
                status: string;
                comment_id: string;
            };
        },
        onSuccess: () => {
            message.success("Changes requested — employee will be notified");
            queryClient.invalidateQueries({ queryKey: QueryKeys.onboarding_invitations.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contracts.all() });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to request changes");
        },
    });

    return { mutation };
};
