import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEmployeeColumns = async (organizationId: string) => {
    const sb_FromEmployeeColumns_Select = await supabase
        .from("employee_columns")
        .select("id, label, type, created_at, updated_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
    if (sb_FromEmployeeColumns_Select.error) throw sb_FromEmployeeColumns_Select.error;
    return sb_FromEmployeeColumns_Select.data;
};

export type Tables_EmployeeColumns_QueryData = Awaited<ReturnType<typeof fetchEmployeeColumns>>;

export const useQ_Tables_EmployeeColumns = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.employee_columns.list(), { organizationId }],
        queryFn: () => fetchEmployeeColumns(organizationId),
    });

    const columns = useMemo(() => query.data || [], [query.data]);

    return { query, columns };
};
