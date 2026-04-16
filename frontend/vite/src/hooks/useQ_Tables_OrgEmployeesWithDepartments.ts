import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgEmployeesWithDepartments = async (organizationId: string) => {
    const sb_FromEmployees_Select = await supabase
        .from("employees")
        .select(
            "id, first_name, last_name, email, rel__department__employee(department_id, is_manager)",
        )
        .eq("organization_id", organizationId)
        .order("first_name", { ascending: true });
    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    return sb_FromEmployees_Select.data;
};

export type Tables_OrgEmployeesWithDepartments_QueryData = Awaited<
    ReturnType<typeof fetchOrgEmployeesWithDepartments>
>;

export const useQ_Tables_OrgEmployeesWithDepartments = ({
    organizationId,
}: {
    organizationId: string;
}) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.departments.list(), ...QueryKeys.entities.list(), "employees", { organizationId }],
        queryFn: () => fetchOrgEmployeesWithDepartments(organizationId),
    });

    const employees = useMemo(() => query.data || [], [query.data]);

    type EmpRecord = (typeof employees)[number];
    type DeptPeople = { managers: EmpRecord[]; employees: EmpRecord[] };

    // Group by department_id, split managers from employees
    const peopleByDeptId = useMemo(() => {
        const map: Record<string, DeptPeople> = {};
        for (const emp of employees) {
            const deptLinks = emp.rel__department__employee ?? [];
            for (const link of deptLinks) {
                const deptId = link.department_id;
                if (!map[deptId]) map[deptId] = { managers: [], employees: [] };
                if (link.is_manager) map[deptId]!.managers.push(emp);
                else map[deptId]!.employees.push(emp);
            }
        }
        return map;
    }, [employees]);

    // Legacy flat lookup (all people regardless of role)
    const employeesByDeptId = useMemo(() => {
        const map: Record<string, typeof employees> = {};
        for (const emp of employees) {
            const deptLinks = emp.rel__department__employee ?? [];
            for (const link of deptLinks) {
                const deptId = link.department_id;
                if (!map[deptId]) map[deptId] = [];
                map[deptId]!.push(emp);
            }
        }
        return map;
    }, [employees]);

    return { query, employees, peopleByDeptId, employeesByDeptId };
};
