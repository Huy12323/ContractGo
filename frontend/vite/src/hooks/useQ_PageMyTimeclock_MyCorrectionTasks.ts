import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyCorrectionTasks = async (employeeId: string) => {
    const sb_FromCorrectionTasks_Select = await supabase
        .from("correction_tasks")
        .select("*, days(id, date, timezone), timeclock_corrections(*)")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false });
    if (sb_FromCorrectionTasks_Select.error) throw sb_FromCorrectionTasks_Select.error;
    return sb_FromCorrectionTasks_Select.data;
};

export type PageMyTimeclock_MyCorrectionTasks_QueryData = Awaited<ReturnType<typeof fetchMyCorrectionTasks>>;

export const useQ_PageMyTimeclock_MyCorrectionTasks = ({ employeeId }: { employeeId: string }) => {
    const query = useQuery({
        enabled: !!employeeId,
        queryKey: [...QueryKeys.correction_tasks.list(), { employeeId }],
        queryFn: () => fetchMyCorrectionTasks(employeeId),
    });

    const correctionTasks = useMemo(() => query.data || [], [query.data]);

    const correctionTasksByDate = useMemo(() => {
        const map = new Map<string, PageMyTimeclock_MyCorrectionTasks_QueryData[number][]>();
        for (const ct of correctionTasks) {
            const date = (ct.days as { date: string } | null)?.date;
            if (!date) continue;
            const arr = map.get(date);
            if (arr) arr.push(ct); else map.set(date, [ct]);
        }
        return map;
    }, [correctionTasks]);

    return { query, correctionTasks, correctionTasksByDate };
};
