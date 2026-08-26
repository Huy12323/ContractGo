import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// Renamed from `useQ_Tables_ContractTemplates` in Phase F. The table keeps its
// `contract_templates` name (renaming it is a migration with no product value),
// so the QueryKeys factory key is unchanged — only the hook and its consumers
// drop the "Contract" prefix that made every template read as an employment
// contract.

// Scoped by ORGANIZATION since CG-030. It was entity-scoped, which is what forced
// every consumer to resolve an entity before it could list anything — and made an
// unresolved entity look like an empty library rather than an error. The entity is
// a label the database fills in; the organization is the only scope the user has.
const fetchTemplates = async (organizationId: string) => {
    const sb_FromContractTemplates_Select = await supabase
        .from("contract_templates")
        .select(
            "id, name, layout, type, pdf_file_path, signer_roles, default_expiry_days, default_reminder_days, created_at, updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        // CG-017: the ONE place one-off uploads are hidden. Both consumers read
        // through here (the library grid and the composer's picker), and
        // `useQ_Tables_Template` deliberately does NOT filter — the composer has to
        // be able to read its own ad-hoc row back by id.
        .eq("is_ad_hoc", false)
        .order("created_at", { ascending: false });
    if (sb_FromContractTemplates_Select.error) throw sb_FromContractTemplates_Select.error;
    return sb_FromContractTemplates_Select.data;
};

export type Tables_Templates_QueryData = Awaited<ReturnType<typeof fetchTemplates>>;
export type Tables_Templates_Record = Tables_Templates_QueryData[number];

export const useQ_Tables_Templates = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.contract_templates.list(), { organizationId }],
        queryFn: () => fetchTemplates(organizationId),
    });

    const templates = useMemo(() => query.data || [], [query.data]);

    return { query, templates };
};
