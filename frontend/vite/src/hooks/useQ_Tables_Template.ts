import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// Single-record read, keyed by template id.
//
// `/templates/$templateId` knows only the template id, so the builder reads its
// own record rather than picking it out of the list hook's result — which also
// means it can read back an ad-hoc row the list deliberately hides (CG-017).

const fetchTemplate = async (templateId: string) => {
    const sb_FromContractTemplates_Select = await supabase
        .from("contract_templates")
        .select(
            "id, name, layout, type, pdf_file_path, signer_roles, default_expiry_days, default_reminder_days, is_archived, created_at, updated_at"
        )
        .eq("id", templateId)
        .single();
    if (sb_FromContractTemplates_Select.error) throw sb_FromContractTemplates_Select.error;
    return sb_FromContractTemplates_Select.data;
};

export type Tables_Template_QueryData = Awaited<ReturnType<typeof fetchTemplate>>;

export const useQ_Tables_Template = ({ templateId }: { templateId: string }) => {
    const query = useQuery({
        enabled: !!templateId,
        queryKey: QueryKeys.contract_templates.record(templateId),
        queryFn: () => fetchTemplate(templateId),
    });

    return { query, template: query.data ?? null };
};
