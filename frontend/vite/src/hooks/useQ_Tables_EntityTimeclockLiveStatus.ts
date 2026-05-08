import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type EmployeeLiveStatus = "working" | "lunch" | "idle";

const fetchEntityLiveStatus = async (entityId: string) => {
    const sb_FromTimeclockSessions_Select = await supabase
        .from("timeclock_sessions")
        .select("employee_id, type")
        .eq("entity_id", entityId)
        .is("end_at", null);
    if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;

    const statusMap: Record<string, EmployeeLiveStatus> = {};
    for (const s of sb_FromTimeclockSessions_Select.data) {
        if (s.type === "break") {
            statusMap[s.employee_id] = "lunch";
        } else if (s.type === "work" && !statusMap[s.employee_id]) {
            statusMap[s.employee_id] = "working";
        }
    }
    return statusMap;
};

export const useQ_Tables_EntityTimeclockLiveStatus = ({ entityId }: { entityId: string }) => {
    const query = useQuery({
        enabled: !!entityId,
        queryKey: [...QueryKeys.timeclock_sessions.list(), "live-status", { entityId }],
        queryFn: () => fetchEntityLiveStatus(entityId),
        refetchInterval: 30_000,
    });

    const statusMap = useMemo(() => query.data || {}, [query.data]);

    return { query, statusMap };
};
