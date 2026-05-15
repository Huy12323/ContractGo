import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyDepartments = async (employeeId: string) => {
    const sb_FromRelDeptEmployee_Select = await supabase
        .from("rel__department__employee")
        .select("department_id, departments!inner(id, name)")
        .eq("employee_id", employeeId);
    if (sb_FromRelDeptEmployee_Select.error) throw sb_FromRelDeptEmployee_Select.error;
    return sb_FromRelDeptEmployee_Select.data;
};

export type PageMyTimeclock_MyDepartments_QueryData = Awaited<ReturnType<typeof fetchMyDepartments>>;

export const useQ_PageMyTimeclock_MyDepartments = ({ employeeId }: { employeeId: string }) => {
    const query = useQuery({
        enabled: !!employeeId,
        queryKey: [...QueryKeys.rel__department__employee.list(), "my-departments", { employeeId }],
        queryFn: () => fetchMyDepartments(employeeId),
    });

    const departments = useMemo(() => query.data || [], [query.data]);

    return { query, departments };
};
