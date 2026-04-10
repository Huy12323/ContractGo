import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_ContractTemplate_Delete_Params = { templateId: string; onSuccess?: () => void };

export const useM_ContractTemplate_Delete = ({ templateId, onSuccess }: UseM_ContractTemplate_Delete_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["contractTemplates", "delete", templateId],
        mutationFn: async () => {
            const sb_FromContractTemplates_Delete = await supabase
                .from("contract_templates")
                .delete()
                .eq("id", templateId);
            if (sb_FromContractTemplates_Delete.error) throw sb_FromContractTemplates_Delete.error;
        },
        onSuccess: () => {
            message.success("Template deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.contractTemplates.all() });
            onSuccess?.();
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete template");
        },
    });

    return { mutation };
};
