import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgEmployees = async (organizationId: string) => {
    const sb_FromEmployees_Select = await supabase
        .from("employees")
        .select("*")
        .eq("organization_id", organizationId)
        .order("first_name", { ascending: true });
    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    return sb_FromEmployees_Select.data;
};

export type Tables_OrgEmployees_QueryData = Awaited<ReturnType<typeof fetchOrgEmployees>>;

export const useQ_Tables_OrgEmployees = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.employees.list(), { organizationId }],
        queryFn: () => fetchOrgEmployees(organizationId),
    });

    const employees = useMemo(() => query.data || [], [query.data]);

    return { query, employees };
};
