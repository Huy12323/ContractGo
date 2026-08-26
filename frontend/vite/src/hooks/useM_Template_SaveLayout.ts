import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { SignerRole, TemplateLayout } from "@/types/template.types";

export type UseM_Template_SaveLayout_Params = {
    /**
     * The DEFAULT target. Optional because the envelope composer binds this hook
     * before the row it will save exists — see `template_id` on the body.
     */
    templateId?: string;
};
export type UseM_Template_SaveLayout_Body = {
    name: string;
    layout: TemplateLayout;
    signer_roles: SignerRole[];
    /**
     * Overrides `templateId` for THIS call.
     *
     * The envelope composer creates its one-off template and saves that template's
     * layout inside a SINGLE async handler, so the id does not exist yet at the
     * render that bound this hook — reading it from state there yields the value
     * from before the create. Passing it per-call is what lets both happen in one
     * tick. The builder, whose template exists for the whole of its lifetime, omits
     * this and uses the bound id.
     */
    template_id?: string;
    /** Only sent when the builder uploaded a replacement source PDF. */
    pdf_file_path?: string | null;
    /** Days after sending that a request from this template should lapse. */
    default_expiry_days: number | null;
    /** Default reminder offsets in days since sending. */
    default_reminder_days: number[];
};

/**
 * The template builder's save — ONE UPDATE, therefore ONE version row.
 *
 * `contract_template_versions` is written by a SECURITY DEFINER trigger on every
 * UPDATE of `contract_templates`, and its `content_hash` covers `layout` +
 * `signer_roles` together. Splitting the save into "write the name, then write the
 * layout" would mint two versions per click and hash a state the user never saw,
 * so name, layout, roles and the source PDF path travel in one statement.
 */
export const useM_Template_SaveLayout = ({ templateId }: UseM_Template_SaveLayout_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["templates", "saveLayout", templateId],
        mutationFn: async (body: UseM_Template_SaveLayout_Body) => {
            const targetId = body.template_id ?? templateId;
            if (!targetId) {
                throw new Error("useM_Template_SaveLayout: no template id to save against");
            }
            const sb_FromContractTemplates_Update = await supabase
                .from("contract_templates")
                .update({
                    name: body.name,
                    layout: body.layout as unknown as Json,
                    signer_roles: body.signer_roles as unknown as Json,
                    // In the SAME statement for the same reason as the layout:
                    // CG-013 extended the versioning trigger's `content_hash` to
                    // cover both, so writing them separately would mint a second
                    // version row per save.
                    default_expiry_days: body.default_expiry_days,
                    default_reminder_days: body.default_reminder_days,
                    ...(body.pdf_file_path !== undefined
                        ? { pdf_file_path: body.pdf_file_path }
                        : {}),
                })
                .eq("id", targetId)
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
            else message.error("Failed to save template");
        },
    });

    return { mutation };
};
