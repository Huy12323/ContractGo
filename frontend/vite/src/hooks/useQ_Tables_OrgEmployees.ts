import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { entityEmployeesTable, type EmployeeDynamicRow } from "@/types/employeeTable.types";

const PAGE_SIZE = 1000;
const DYNAMIC_BATCH_SIZE = 300;

const fetchPage = (entityId: string, searchText: string | undefined, offset: number) => {
    let q = supabase
        .from("employees")
        .select("*, entities(id, name, timezone)")
        .eq("entity_id", entityId)
        .order("first_name", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
    if (searchText) q = q.ilike("__full_name", `%${searchText}%`);
    return q;
};

const fetchAllPages = async (entityId: string, searchText?: string) => {
    const first = await fetchPage(entityId, searchText, 0);
    if (first.error) throw first.error;
    const all = [...(first.data ?? [])];
    if (all.length < PAGE_SIZE) return all;
    let offset = PAGE_SIZE;
    while (true) {
        const { data, error } = await fetchPage(entityId, searchText, offset);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    return all;
};

const fetchDynamicBatches = async (table: string, ids: string[]): Promise<EmployeeDynamicRow[]> => {
    if (ids.length === 0) return [];
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += DYNAMIC_BATCH_SIZE)
        batches.push(ids.slice(i, i + DYNAMIC_BATCH_SIZE));
    const results = await Promise.all(
        batches.map((batch) =>
            supabase.from(table as "employees").select("*").in("employee_id", batch),
        ),
    );
    const rows: EmployeeDynamicRow[] = [];
    for (const r of results) {
        if (r.error) throw r.error;
        rows.push(...((r.data ?? []) as unknown as EmployeeDynamicRow[]));
    }
    return rows;
};

const fetchEntityEmployees = async (entityId: string, searchText?: string) => {
    const perEntityTable = entityEmployeesTable(entityId);

    const employees = await fetchAllPages(entityId, searchText);
    const employeeIds = employees.map((e) => e.id);
    const dynamicRows = await fetchDynamicBatches(perEntityTable, employeeIds);
    const dynamicByEmployeeId = new Map(dynamicRows.map((r) => [r.employee_id, r]));

    return employees.map((emp) => ({
        ...emp,
        ...(dynamicByEmployeeId.get(emp.id) ?? {}),
    }));
};

export type Tables_OrgEmployees_QueryData = Awaited<ReturnType<typeof fetchEntityEmployees>>;

export const useQ_Tables_OrgEmployees = ({ entityId, searchText }: { entityId: string; searchText?: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.employees.list(), `${entityId}__employees`, 'list', { entityId, searchText: searchText || "" }],
        queryFn: () => fetchEntityEmployees(entityId, searchText),
    });

    const employees = useMemo(() => query.data || [], [query.data]);

    return { query, employees };
};
