import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEntityEmployees = async (entityId: string) => {
    const sb_FromEntityEmployees_Select = await supabase
        .from("entity_employees")
        .select("id, entity_id, user_id, created_at, profiles(id, full_name, email, avatar_url)")
        .eq("entity_id", entityId)
        .order("created_at", { ascending: true });
    if (sb_FromEntityEmployees_Select.error) throw sb_FromEntityEmployees_Select.error;
    return sb_FromEntityEmployees_Select.data;
};

export type Tables_EntityEmployees_QueryData = Awaited<ReturnType<typeof fetchEntityEmployees>>;

export const useQ_Tables_EntityEmployees = ({ entityId }: { entityId: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.entities.record(entityId), ...QueryKeys.entityEmployees.list()],
        queryFn: () => fetchEntityEmployees(entityId),
    });

    const employees = useMemo(() => query.data || [], [query.data]);

    return { query, employees };
};
