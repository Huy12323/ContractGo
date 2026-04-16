import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgEmployeeViews = async (organizationId: string) => {
    const sb_FromEmployeeViews_Select = await supabase
        .from("employee_views")
        .select("*")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    if (sb_FromEmployeeViews_Select.error) throw sb_FromEmployeeViews_Select.error;
    return sb_FromEmployeeViews_Select.data;
};

export type Tables_OrgEmployeeViews_QueryData = Awaited<ReturnType<typeof fetchOrgEmployeeViews>>;

export const useQ_Tables_OrgEmployeeViews = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.employeeViews.list(), { organizationId }],
        queryFn: () => fetchOrgEmployeeViews(organizationId),
    });

    const employeeViews = useMemo(() => query.data || [], [query.data]);

    return { query, employeeViews };
};
