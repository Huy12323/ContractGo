import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEmployeeColumnChoices = async (organizationId: string) => {
    const sb_FromEmployeeColumnChoices_Select = await supabase
        .from("employee_column_choices")
        .select("id, employee_column_id, label, value, sort_order, created_at")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true });
    if (sb_FromEmployeeColumnChoices_Select.error) throw sb_FromEmployeeColumnChoices_Select.error;
    return sb_FromEmployeeColumnChoices_Select.data;
};

export type Tables_EmployeeColumnChoices_QueryData = Awaited<ReturnType<typeof fetchEmployeeColumnChoices>>;

export const useQ_Tables_EmployeeColumnChoices = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.employeeColumnChoices.list(), { organizationId }],
        queryFn: () => fetchEmployeeColumnChoices(organizationId),
    });

    const choices = useMemo(() => query.data || [], [query.data]);

    return { query, choices };
};
