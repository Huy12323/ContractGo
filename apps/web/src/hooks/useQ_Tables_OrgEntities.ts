import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgEntities = async (organizationId: string) => {
    const sb_FromEntities_Select = await supabase
        .from("entities")
        .select("id, name, timezone, locale, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
    if (sb_FromEntities_Select.error) throw sb_FromEntities_Select.error;
    return sb_FromEntities_Select.data;
};

export type Tables_OrgEntities_QueryData = Awaited<ReturnType<typeof fetchOrgEntities>>;

export const useQ_Tables_OrgEntities = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.entities.list(), { organizationId }],
        queryFn: () => fetchOrgEntities(organizationId),
    });

    const entities = useMemo(() => query.data || [], [query.data]);

    return { query, entities };
};
