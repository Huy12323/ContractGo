import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Json } from "@/types/database.types";
import type { SignerRole, TemplateLayout } from "@/types/template.types";

export type UseM_Template_Create_Params = {
    organization_id: string;
    name: string;
    layout: TemplateLayout;
    signer_roles: SignerRole[];
    pdf_file_path?: string | null;
    /** CG-017: a document uploaded during composition, hidden from the library. */
    is_ad_hoc?: boolean;
};

/**
 * Creates a PDF template row.
 *
 * `type` is not a parameter: the tiptap kind is retired (creation blocked, UI
 * deleted), so every template this app makes is `pdf`. The enum value survives in
 * Postgres only so pre-existing rows still type-check.
 *
 * `entity_id` is not a parameter either, and must not become one. It is NOT NULL
 * in Postgres, but CG-030's BEFORE INSERT trigger derives it from
 * `organization_id` — see `database.override.types.ts` for why the generated
 * Insert type has to be corrected to say so.
 */
export const useM_Template_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["templates", "create"],
        mutationFn: async (body: UseM_Template_Create_Params) => {
            const sb_FromContractTemplates_Insert = await supabase
                .from("contract_templates")
                .insert({
                    organization_id: body.organization_id,
                    name: body.name,
                    layout: body.layout as unknown as Json,
                    signer_roles: body.signer_roles as unknown as Json,
                    pdf_file_path: body.pdf_file_path ?? null,
                    type: "pdf",
                    is_ad_hoc: body.is_ad_hoc ?? false,
                })
                .select()
                .single();
            if (sb_FromContractTemplates_Insert.error) throw sb_FromContractTemplates_Insert.error;
            return sb_FromContractTemplates_Insert.data;
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
            else message.error("Failed to create template");
        },
    });

    return { mutation };
};
