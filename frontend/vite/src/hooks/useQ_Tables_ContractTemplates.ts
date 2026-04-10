import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchContractTemplates = async (organizationId: string) => {
    const sb_FromContractTemplates_Select = await supabase
        .from("contract_templates")
        .select("id, name, layout, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
    if (sb_FromContractTemplates_Select.error) throw sb_FromContractTemplates_Select.error;
    return sb_FromContractTemplates_Select.data;
};

export type Tables_ContractTemplates_QueryData = Awaited<ReturnType<typeof fetchContractTemplates>>;

export const useQ_Tables_ContractTemplates = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.contractTemplates.list(), { organizationId }],
        queryFn: () => fetchContractTemplates(organizationId),
    });

    const templates = useMemo(() => query.data || [], [query.data]);

    return { query, templates };
};
