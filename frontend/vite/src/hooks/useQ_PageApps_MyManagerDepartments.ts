import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { useStore_Auth_User } from "@/stores/Store_Auth";

const fetchMyManagerDepartments = async (userId: string, entityId: string) => {
    const sb_FromEmployees_Select = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", userId)
        .eq("entity_id", entityId)
        .maybeSingle();
    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    if (!sb_FromEmployees_Select.data) return [];

    const sb_FromRelDeptEmployee_Select = await supabase
        .from("rel__department__employee")
        .select("department_id, departments!inner(id, name)")
        .eq("employee_id", sb_FromEmployees_Select.data.id)
        .eq("is_manager", true);
    if (sb_FromRelDeptEmployee_Select.error) throw sb_FromRelDeptEmployee_Select.error;
    return sb_FromRelDeptEmployee_Select.data;
};

export type PageApps_MyManagerDepartments_QueryData = Awaited<ReturnType<typeof fetchMyManagerDepartments>>;

export const useQ_PageApps_MyManagerDepartments = ({ entityId }: { entityId: string }) => {
    const user = useStore_Auth_User();
    const userId = user?.id ?? "";

    const query = useQuery({
        enabled: !!userId && !!entityId,
        queryKey: [...QueryKeys.rel__department__employee.list(), "my-managed", { entityId }],
        queryFn: () => fetchMyManagerDepartments(userId, entityId),
    });

    const managedDepartments = useMemo(() => query.data || [], [query.data]);
    const isManager = managedDepartments.length > 0;

    return { query, managedDepartments, isManager };
};
