import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EmployeeView_Delete_Body = { viewId: string };

export const useM_EmployeeView_Delete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ viewId }: UseM_EmployeeView_Delete_Body) => {
            const sb_FromEmployeeViews_Delete = await supabase
                .from("employee_views")
                .delete()
                .eq("id", viewId);
            if (sb_FromEmployeeViews_Delete.error) throw sb_FromEmployeeViews_Delete.error;
        },
        onSuccess: () => {
            message.success("View deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_views.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete view");
        },
    });

    return { mutation };
};
