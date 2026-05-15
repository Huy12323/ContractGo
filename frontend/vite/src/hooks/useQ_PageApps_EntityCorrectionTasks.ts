import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchEntityCorrectionTasks = async (entityId: string) => {
    const sb_FromCorrectionTasks_Select = await supabase
        .from("correction_tasks")
        .select("*, days(id, date, timezone), timeclock_corrections(*), employees(id, first_name, last_name, email, __full_name), rel__correction_task__department(correction_task_id, department_id, decision, decided_by, decided_at, departments(id, name))")
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false });
    if (sb_FromCorrectionTasks_Select.error) throw sb_FromCorrectionTasks_Select.error;
    return sb_FromCorrectionTasks_Select.data;
};

export type PageApps_EntityCorrectionTasks_QueryData = Awaited<ReturnType<typeof fetchEntityCorrectionTasks>>;

export const useQ_PageApps_EntityCorrectionTasks = ({ entityId }: { entityId: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.correction_tasks.list(), { entityId }],
        queryFn: () => fetchEntityCorrectionTasks(entityId),
    });

    const correctionTasks = useMemo(() => query.data || [], [query.data]);
    const pendingTasks = useMemo(() => correctionTasks.filter((ct) => ct.status === "pending" || ct.status === "manager_approved"), [correctionTasks]);

    return { query, correctionTasks, pendingTasks };
};
