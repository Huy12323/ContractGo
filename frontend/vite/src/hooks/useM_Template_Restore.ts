import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { SignerRole, TemplateLayout } from "@/types/template.types";

export type UseM_Template_Restore_Params = { templateId: string };
export type UseM_Template_Restore_Body = {
    layout: TemplateLayout;
    signer_roles: SignerRole[];
    pdf_file_path: string | null;
    versionNumber: number;
};

/**
 * Restores a past version by writing its content back onto the template.
 *
 * This is a forward write, not a rewind: the restore itself mints a NEW version
 * row whose content equals the old one. Version history stays append-only, so
 * "restored to v3" is itself an auditable event rather than a gap in the chain.
 */
export const useM_Template_Restore = ({ templateId }: UseM_Template_Restore_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["templates", "restore", templateId],
        mutationFn: async (body: UseM_Template_Restore_Body) => {
            const sb_FromContractTemplates_Update = await supabase
                .from("contract_templates")
                .update({
                    layout: body.layout as unknown as Json,
                    signer_roles: body.signer_roles as unknown as Json,
                    pdf_file_path: body.pdf_file_path,
                })
                .eq("id", templateId)
                .select()
                .single();
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error;
            return {
                data: sb_FromContractTemplates_Update.data,
                versionNumber: body.versionNumber,
            };
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
