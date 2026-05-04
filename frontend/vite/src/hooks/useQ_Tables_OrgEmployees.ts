import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { orgEmployeesTable, type EmployeeDynamicRow } from "@/types/employeeTable.types";

const fetchOrgEmployees = async (organizationId: string) => {
    // Per-org dynamic-columns table name. Cast to a real table key so the
    // SDK call type-checks; the runtime table name is dynamic per org.
    const perOrgTable = orgEmployeesTable(organizationId) as "employees";

    const [sb_FromEmployees_Select, sb_FromOrgEmployees_Select] = await Promise.all([
        supabase
            .from("employees")
            .select("*")
            .eq("organization_id", organizationId)
            .order("first_name", { ascending: true }),
        supabase.from(perOrgTable).select("*"),
    ]);

    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    if (sb_FromOrgEmployees_Select.error) throw sb_FromOrgEmployees_Select.error;

    // Index per-org rows by employee_id for O(1) merge lookup.
    const dynamicRows = (sb_FromOrgEmployees_Select.data ?? []) as unknown as EmployeeDynamicRow[];
    const dynamicByEmployeeId = new Map(dynamicRows.map((r) => [r.employee_id, r]));

    return sb_FromEmployees_Select.data.map((emp) => ({
        ...emp,
        ...(dynamicByEmployeeId.get(emp.id) ?? {}),
    }));
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
