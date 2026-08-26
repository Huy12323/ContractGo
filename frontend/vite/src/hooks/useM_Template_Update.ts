import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Template_Update_Params = { templateId: string };
export type UseM_Template_Update_Body = Partial<{
    name: string;
    pdf_file_path: string | null;
}>;

/**
 * Metadata-only edits — rename from the template list.
 *
 * Layout and roles deliberately are NOT writable here: the versioning trigger
 * fires per UPDATE, so the builder must land name + layout + roles + pdf in a
 * single statement or every save produces two version rows. That is
 * `useM_Template_SaveLayout`.
 */
export const useM_Template_Update = ({ templateId }: UseM_Template_Update_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["templates", "update", templateId],
        mutationFn: async (body: UseM_Template_Update_Body) => {
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
        onError: (err: { code?: string }) => {
            console.error(err);
            if (err?.code === "23505")
                message.error(
                    "A template with this name already exists. Please choose a different name."
                );
            else message.error("Failed to update template");
        },
    });

    return { mutation };
};
