import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgDepartments = async (organizationId: string) => {
    const sb_FromDepartments_Select = await supabase
        .from("departments")
        .select("id, name, entity_id, parent_id, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
    if (sb_FromDepartments_Select.error) throw sb_FromDepartments_Select.error;
    return sb_FromDepartments_Select.data;
};

export type Tables_OrgDepartments_QueryData = Awaited<ReturnType<typeof fetchOrgDepartments>>;

export const useQ_Tables_OrgDepartments = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.departments.list(), { organizationId }],
        queryFn: () => fetchOrgDepartments(organizationId),
    });

    const departments = useMemo(() => query.data || [], [query.data]);

    return { query, departments };
};
