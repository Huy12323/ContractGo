import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type CorrectionEntry = {
    type: "work" | "break";
    start_at: string;
    end_at: string;
    duration_ms: number;
    session_id: string | null;
};

export type UseM_PageMyTimeclock_CorrectionTaskCreate_Params = {
    employee_id: string;
    entity_id: string;
    day_date: string;
    timezone: string;
    message: string;
    entries: CorrectionEntry[];
};

export const useM_PageMyTimeclock_CorrectionTaskCreate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_PageMyTimeclock_CorrectionTaskCreate_Params) => {
            const sb_RpcGetOrCreateDay = await supabase.rpc("get_or_create_day", {
                p_date: body.day_date,
                p_tz: body.timezone,
            });
            if (sb_RpcGetOrCreateDay.error) throw sb_RpcGetOrCreateDay.error;
            const dayId = sb_RpcGetOrCreateDay.data;

            const sb_FromCorrectionTasks_Select = await supabase
                .from("correction_tasks")
                .select("id")
                .eq("employee_id", body.employee_id)
                .eq("day_id", dayId)
                .eq("status", "pending")
                .limit(1);
            if (sb_FromCorrectionTasks_Select.error) throw sb_FromCorrectionTasks_Select.error;
            if (sb_FromCorrectionTasks_Select.data.length > 0) {
                throw new Error("A pending correction already exists for this day");
            }

            const sb_FromCorrectionTasks_Insert = await supabase
                .from("correction_tasks")
                .insert({
                    employee_id: body.employee_id,
                    entity_id: body.entity_id,
                    day_id: dayId,
                    message: body.message || null,
                })
                .select()
                .single();
            if (sb_FromCorrectionTasks_Insert.error) throw sb_FromCorrectionTasks_Insert.error;
            const task = sb_FromCorrectionTasks_Insert.data;

            if (body.entries.length > 0) {
                const rows = body.entries.map((e) => ({
                    correction_task_id: task.id,
                    day_id: dayId,
                    type: e.type,
                    start_at: e.start_at,
                    end_at: e.end_at,
                    duration_ms: e.duration_ms,
                    session_id: e.session_id,
                }));
                const sb_FromTimeclockCorrections_Insert = await supabase
                    .from("timeclock_corrections")
                    .insert(rows);
                if (sb_FromTimeclockCorrections_Insert.error) throw sb_FromTimeclockCorrections_Insert.error;
            }

            return task;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.correction_tasks.list() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.timeclock_corrections.list() });
            message.success("Correction request submitted");
        },
        onError: (error) => {
            console.error("Correction create error:", error);
            message.error(error.message === "A pending correction already exists for this day"
                ? "A pending correction already exists for this day"
                : "Failed to submit correction request");
        },
    });

    return { mutation };
};
