import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { useStore_Auth_User } from "@/stores/Store_Auth";

const fetchMyEmployeeEntities = async (userId: string, organizationId: string) => {
    const sb_FromEmployees_Select = await supabase
        .from("employees")
        .select("id, entity_id, entities(id, name, timezone)")
        .eq("user_id", userId)
        .eq("organization_id", organizationId);
    if (sb_FromEmployees_Select.error) throw sb_FromEmployees_Select.error;
    return sb_FromEmployees_Select.data;
};

export type Tables_MyEmployeeEntities_QueryData = Awaited<ReturnType<typeof fetchMyEmployeeEntities>>;

export const useQ_Tables_MyEmployeeEntities = ({ organizationId }: { organizationId: string }) => {
    const user = useStore_Auth_User();
    const userId = user?.id ?? "";

    const query = useQuery({
        enabled: !!userId && !!organizationId,
        queryKey: [...QueryKeys.employees.list(), "my-entities", { organizationId }],
        queryFn: () => fetchMyEmployeeEntities(userId, organizationId),
    });

    const employeeEntities = useMemo(() => query.data || [], [query.data]);

    return { query, employeeEntities };
};
