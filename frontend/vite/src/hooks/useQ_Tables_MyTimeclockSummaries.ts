import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyTimeclockSessions = async (employeeId: string, startUtc: string, endUtc: string) => {
    const sb_FromTimeclockSessions_Select = await supabase
        .from("timeclock_sessions")
        .select("type, start_at, end_at, duration_ms")
        .eq("employee_id", employeeId)
        .gte("start_at", startUtc)
        .lt("start_at", endUtc)
        .order("start_at", { ascending: true });
    if (sb_FromTimeclockSessions_Select.error) throw sb_FromTimeclockSessions_Select.error;
    return sb_FromTimeclockSessions_Select.data;
};

export const useQ_Tables_MyTimeclockSummaries = ({
    employeeId,
    startDate,
    endDate,
}: {
    employeeId: string;
    startDate: string;
    endDate: string;
}) => {
    const query = useQuery({
        enabled: !!employeeId && !!startDate && !!endDate,
        queryKey: [...QueryKeys.timeclock_sessions.list(), "my", { employeeId, startDate, endDate }],
        queryFn: () => fetchMyTimeclockSessions(employeeId, startDate, endDate),
    });

    const summaries = useMemo(() => query.data || [], [query.data]);

    return { query, summaries };
};
