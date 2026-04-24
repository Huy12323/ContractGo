import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { Enums } from "@/types/database.helpers";

export type UseM_ContractTemplate_Restore_Params = { templateId: string };
export type UseM_ContractTemplate_Restore_Body = {
    layout: Json;
    type: Enums<"contract_template_type_enum">;
    pdf_file_path: string | null;
    mandatory_field_keys: string[];
    hr_field_keys: string[];
    attachment_field_keys: string[];
    versionNumber: number;
};

export const useM_ContractTemplate_Restore = ({
    templateId,
}: UseM_ContractTemplate_Restore_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["contractTemplates", "restore", templateId],
        mutationFn: async (body: UseM_ContractTemplate_Restore_Body) => {
            const sb_FromContractTemplates_Update = await supabase
                .from("contract_templates")
                .update({
                    layout: body.layout,
                    type: body.type,
                    pdf_file_path: body.pdf_file_path,
                    mandatory_field_keys: body.mandatory_field_keys,
                    hr_field_keys: body.hr_field_keys,
                    attachment_field_keys: body.attachment_field_keys,
                })
                .eq("id", templateId)
                .select()
                .single();
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error;
            return { data: sb_FromContractTemplates_Update.data, versionNumber: body.versionNumber };
        },
        onSuccess: ({ versionNumber }) => {
            message.success(`Restored to v${versionNumber}`);
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to restore version");
        },
    });

    return { mutation };
};
