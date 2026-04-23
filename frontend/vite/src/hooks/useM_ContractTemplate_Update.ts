import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";

export type UseM_ContractTemplate_Update_Params = { templateId: string };
export type UseM_ContractTemplate_Update_Body = Partial<{ name: string; layout: Json; mandatory_field_keys: string[] }>;

export const useM_ContractTemplate_Update = ({ templateId }: UseM_ContractTemplate_Update_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["contractTemplates", "update", templateId],
        mutationFn: async (body: UseM_ContractTemplate_Update_Body) => {
            const sb_FromContractTemplates_Update = await supabase
                .from("contract_templates")
                .update(body)
                .eq("id", templateId)
                .select()
                .single();
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error;
            return sb_FromContractTemplates_Update.data;
        },
        onSuccess: () => {
            message.success("Template updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update template");
        },
    });

    return { mutation };
};
