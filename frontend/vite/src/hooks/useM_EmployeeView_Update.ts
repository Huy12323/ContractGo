import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { EmployeeView_Config } from "@/types/employeeTable.types";

export type UseM_EmployeeView_Update_Body = {
    viewId: string;
    name?: string;
    config?: EmployeeView_Config;
};

export const useM_EmployeeView_Update = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ viewId, ...patch }: UseM_EmployeeView_Update_Body) => {
            const sb_FromEmployeeViews_Update = await supabase
                .from("employee_views")
                .update(patch)
                .eq("id", viewId)
                .select()
                .single();
            if (sb_FromEmployeeViews_Update.error) throw sb_FromEmployeeViews_Update.error;
            return sb_FromEmployeeViews_Update.data;
        },
        onSuccess: (_data, body) => {
            const isRename = body.name !== undefined && body.config === undefined;
            message.success(isRename ? "View renamed" : "View saved");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employeeViews.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update view");
        },
    });

    return { mutation };
};
