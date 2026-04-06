import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEntityDepartments = async (entityId: string) => {
    const sb_FromDepartments_Select = await supabase
        .from("departments")
        .select("id, name, entity_id, parent_id, created_at, updated_at")
        .eq("entity_id", entityId)
        .order("created_at", { ascending: true });
    if (sb_FromDepartments_Select.error) throw sb_FromDepartments_Select.error;
    return sb_FromDepartments_Select.data;
};

export type Tables_EntityDepartments_QueryData = Awaited<ReturnType<typeof fetchEntityDepartments>>;

export const useQ_Tables_EntityDepartments = ({ entityId }: { entityId: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.entities.record(entityId), ...QueryKeys.departments.list()],
        queryFn: () => fetchEntityDepartments(entityId),
    });

    const departments = useMemo(() => query.data || [], [query.data]);

    return { query, departments };
};
