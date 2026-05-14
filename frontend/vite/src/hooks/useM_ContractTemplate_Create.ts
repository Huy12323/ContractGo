import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { Enums } from "@/types/database.helpers";

export type UseM_ContractTemplate_Create_Params = {
    entity_id: string;
    name: string;
    layout: Json;
    type?: Enums<"contract_template_type_enum">;
    pdf_file_path?: string | null;
    mandatory_field_keys?: string[];
    hr_field_keys?: string[];
    attachment_field_keys?: string[];
};

export const useM_ContractTemplate_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_ContractTemplate_Create_Params) => {
            const sb_FromContractTemplates_Insert = await supabase
                .from("contract_templates")
                .insert(body)
                .select()
                .single();
            if (sb_FromContractTemplates_Insert.error) throw sb_FromContractTemplates_Insert.error;
            return sb_FromContractTemplates_Insert.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() });
        },
        onError: (err: any) => {
            console.error(err);
            if (err?.code === "23505") message.error("A template with this name already exists. Please choose a different name.");
            else message.error("Failed to create template");
        },
    });

    return { mutation };
};
