import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { entityEmployeesTable, type EmployeeDynamicRow } from "@/types/employeeTable.types";

const fetchEntityEmployees = async (entityId: string, searchText?: string) => {
    const perEntityTable = entityEmployeesTable(entityId) as "employees";

    let empQuery = supabase
        .from("employees")
        .select("*, entities(id, name, timezone)")
        .eq("entity_id", entityId);

    if (searchText) {
        empQuery = empQuery.ilike("__full_name", `%${searchText}%`);
    }

    empQuery = empQuery.order("first_name", { ascending: true });

    const [sb_FromEmployees_Select, sb_FromEntityEmployees_Select] = await Promise.all([
        empQuery,
        supabase.from(perEntityTable).select("*"),
    ]);

    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    if (sb_FromEntityEmployees_Select.error) throw sb_FromEntityEmployees_Select.error;

    const dynamicRows = (sb_FromEntityEmployees_Select.data ?? []) as unknown as EmployeeDynamicRow[];
    const dynamicByEmployeeId = new Map(dynamicRows.map((r) => [r.employee_id, r]));

    const result = sb_FromEmployees_Select.data.map((emp) => ({
        ...emp,
        ...(dynamicByEmployeeId.get(emp.id) ?? {}),
    }));
    return result;
};

export type Tables_OrgEmployees_QueryData = Awaited<ReturnType<typeof fetchEntityEmployees>>;

export const useQ_Tables_OrgEmployees = ({ entityId, searchText }: { entityId: string; searchText?: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.employees.list(), { entityId, searchText: searchText || "" }],
        queryFn: () => fetchEntityEmployees(entityId, searchText),
    });

    const employees = useMemo(() => query.data || [], [query.data]);

    return { query, employees };
};
