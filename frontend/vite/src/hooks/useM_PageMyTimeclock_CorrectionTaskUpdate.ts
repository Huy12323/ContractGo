import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { CorrectionEntry } from "./useM_PageMyTimeclock_CorrectionTaskCreate";

export type UseM_PageMyTimeclock_CorrectionTaskUpdate_Params = {
    correctionTaskId: string;
    message: string;
    entries: CorrectionEntry[];
    dayId: string;
};

export const useM_PageMyTimeclock_CorrectionTaskUpdate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_PageMyTimeclock_CorrectionTaskUpdate_Params) => {
            const sb_FromTimeclockCorrections_Delete = await supabase
                .from("timeclock_corrections")
                .delete()
                .eq("correction_task_id", body.correctionTaskId);
            if (sb_FromTimeclockCorrections_Delete.error) throw sb_FromTimeclockCorrections_Delete.error;

            const sb_FromCorrectionTasks_Update = await supabase
                .from("correction_tasks")
                .update({ message: body.message || null, updated_at: new Date().toISOString() })
                .eq("id", body.correctionTaskId)
                .eq("status", "pending")
                .select()
                .single();
            if (sb_FromCorrectionTasks_Update.error) throw sb_FromCorrectionTasks_Update.error;

            if (body.entries.length > 0) {
                const rows = body.entries.map((e) => ({
                    correction_task_id: body.correctionTaskId,
                    day_id: body.dayId,
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

            return sb_FromCorrectionTasks_Update.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.correction_tasks.list() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.timeclock_corrections.list() });
            message.success("Correction request updated");
        },
        onError: (error) => {
            console.error("Correction update error:", error);
            message.error("Failed to update correction request");
        },
    });

    return { mutation };
};
