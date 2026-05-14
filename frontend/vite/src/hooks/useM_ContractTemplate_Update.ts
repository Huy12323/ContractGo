import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { Enums } from "@/types/database.helpers";

export type UseM_ContractTemplate_Update_Params = { templateId: string };
export type UseM_ContractTemplate_Update_Body = Partial<{
    name: string;
    layout: Json;
    type: Enums<"contract_template_type_enum">;
    pdf_file_path: string | null;
    mandatory_field_keys: string[];
    hr_field_keys: string[];
    attachment_field_keys: string[];
}>;

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
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() });
        },
        onError: (err: any) => {
            console.error(err);
            if (err?.code === "23505") message.error("A template with this name already exists. Please choose a different name.");
            else message.error("Failed to update template");
        },
    });

    return { mutation };
};
