import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { AVATAR_FILE_SELECT } from "@/utils/Utils_Avatar_Src";
import { QueryKeys } from "@/utils/query/queryKeys";

// Renamed from `useQ_Tables_ContractTemplateVersions` in Phase F. Rows are written
// by the immutable versioning trigger on `contract_templates`, never by the client.

const fetchTemplateVersions = async (templateId: string) => {
    const sb_FromContractTemplateVersions_Select = await supabase
        .from("contract_template_versions")
        .select(
            `id, template_id, organization_id, version_number, type, layout, pdf_file_path, signer_roles, content_hash, created_at, created_by, profiles(id, full_name, email, avatar_url, ${AVATAR_FILE_SELECT})`
        )
        .eq("template_id", templateId)
        .order("version_number", { ascending: false });
    if (sb_FromContractTemplateVersions_Select.error)
        throw sb_FromContractTemplateVersions_Select.error;
    return sb_FromContractTemplateVersions_Select.data;
};

export type Tables_TemplateVersions_QueryData = Awaited<ReturnType<typeof fetchTemplateVersions>>;
export type Tables_TemplateVersions_Record = Tables_TemplateVersions_QueryData[number];

export const useQ_Tables_TemplateVersions = ({ templateId }: { templateId: string }) => {
    const query = useQuery({
        enabled: !!templateId,
        queryKey: [...QueryKeys.contract_template_versions.list(), { templateId }],
        queryFn: () => fetchTemplateVersions(templateId),
    });

    const versions = useMemo(() => query.data || [], [query.data]);

    return { query, versions };
};
