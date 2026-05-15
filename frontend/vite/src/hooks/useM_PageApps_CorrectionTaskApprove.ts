import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_PageApps_CorrectionTaskApprove_Params = {
    correctionTaskId: string;
};

export const useM_PageApps_CorrectionTaskApprove = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_PageApps_CorrectionTaskApprove_Params) => {
            const sb_RpcApproveCorrectionTask = await supabase.rpc("approve_correction_task", {
                p_correction_task_id: body.correctionTaskId,
                p_action: "approve",
            });
            if (sb_RpcApproveCorrectionTask.error) throw sb_RpcApproveCorrectionTask.error;
            const result = sb_RpcApproveCorrectionTask.data as { success: boolean; new_status: string; message: string };
            if (!result.success) throw new Error(result.message);
            return result;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.correction_tasks.list() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.rel__correction_task__department.list() });
            message.success(data.message);
        },
        onError: (error) => {
            console.error("Correction approve error:", error);
            message.error(error.message || "Failed to approve correction");
        },
    });

    return { mutation };
};
