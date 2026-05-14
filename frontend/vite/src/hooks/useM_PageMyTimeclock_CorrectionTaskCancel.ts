import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_PageMyTimeclock_CorrectionTaskCancel_Params = { correctionTaskId: string };

export const useM_PageMyTimeclock_CorrectionTaskCancel = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_PageMyTimeclock_CorrectionTaskCancel_Params) => {
            const sb_FromCorrectionTasks_Update = await supabase
                .from("correction_tasks")
                .update({ status: "cancelled" as const })
                .eq("id", body.correctionTaskId)
                .eq("status", "pending")
                .select()
                .single();
            if (sb_FromCorrectionTasks_Update.error) throw sb_FromCorrectionTasks_Update.error;
            return sb_FromCorrectionTasks_Update.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.correction_tasks.list() });
            message.success("Correction request cancelled");
        },
        onError: (error) => {
            console.error("Correction cancel error:", error);
            message.error("Failed to cancel correction request");
        },
    });

    return { mutation };
};
