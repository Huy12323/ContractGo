import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type TimesheetGridRow = {
    employee_id: string;
    work_date: string;
    worked_ms: number;
    break_ms: number;
};

const fetchTimesheetGridBatch = async (
    entityId: string,
    startUtc: string,
    endUtc: string,
    timezone: string,
    employeeIds: string[]
): Promise<TimesheetGridRow[]> => {
    const { data, error } = await supabase.rpc("get_timesheet_grid", {
        p_entity_id: entityId,
        p_start_utc: startUtc,
        p_end_utc: endUtc,
        p_timezone: timezone,
        p_employee_ids: employeeIds,
    });
    if (error) throw error;
    return (data ?? []) as TimesheetGridRow[];
};

export const useQ_Tables_TimesheetGrid = ({
    entityId,
    startUtc,
    endUtc,
    timezone,
    employeeBatches,
    enabledBatches,
}: {
    entityId: string;
    startUtc: string;
    endUtc: string;
    timezone: string;
    employeeBatches: string[][];
    enabledBatches: Set<number>;
}) => {
    const batchQueries = useQueries({
        queries: employeeBatches.map((ids, idx) => ({
            queryKey: [...QueryKeys.timeclock_sessions.list(), "grid-batch", { entityId, startUtc, endUtc, timezone, ids }],
            queryFn: () => fetchTimesheetGridBatch(entityId, startUtc, endUtc, timezone, ids),
            enabled: !!entityId && !!startUtc && !!endUtc && enabledBatches.has(idx),
            staleTime: 5 * 60 * 1000,
        })),
    });

    const summaryIndex = useMemo(() => {
        const index = new Map<string, number>();
        for (const q of batchQueries) {
            if (q.data) {
                for (const row of q.data) {
                    index.set(`${row.employee_id}|${row.work_date}`, row.worked_ms);
                }
            }
        }
        return index;
    }, [batchQueries]);

    const isAnyLoading = batchQueries.some((q) => q.isLoading && q.fetchStatus !== "idle");

    return { batchQueries, summaryIndex, isAnyLoading };
};
