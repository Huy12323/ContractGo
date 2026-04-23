import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchContractTemplateVersions = async (templateId: string) => {
    const sb_FromContractTemplateVersions_Select = await supabase
        .from("contract_template_versions")
        .select(
            "id, template_id, organization_id, version_number, type, layout, pdf_file_path, mandatory_field_keys, content_hash, created_at, created_by, profiles(id, full_name, email, avatar_url)",
        )
        .eq("template_id", templateId)
        .order("version_number", { ascending: false });
    if (sb_FromContractTemplateVersions_Select.error) throw sb_FromContractTemplateVersions_Select.error;
    return sb_FromContractTemplateVersions_Select.data;
};

export type Tables_ContractTemplateVersions_QueryData = Awaited<
    ReturnType<typeof fetchContractTemplateVersions>
>;

export const useQ_Tables_ContractTemplateVersions = ({
    templateId,
}: {
    templateId: string;
}) => {
    const query = useQuery({
        enabled: !!templateId,
        queryKey: [...QueryKeys.contract_template_versions.list(), { templateId }],
        queryFn: () => fetchContractTemplateVersions(templateId),
    });

    const versions = useMemo(() => query.data || [], [query.data]);

    return { query, versions };
};
