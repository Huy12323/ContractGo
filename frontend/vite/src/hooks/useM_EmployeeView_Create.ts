import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { EmployeeView_Config } from "@/types/employeeTable.types";

export type UseM_EmployeeView_Create_Params = {
    organization_id: string;
    name: string;
    config: EmployeeView_Config;
    sort_order?: number;
};

export const useM_EmployeeView_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_EmployeeView_Create_Params) => {
            const sb_FromEmployeeViews_Insert = await supabase
                .from("employee_views")
                .insert(body)
                .select()
                .single();
            if (sb_FromEmployeeViews_Insert.error) throw sb_FromEmployeeViews_Insert.error;
            return sb_FromEmployeeViews_Insert.data;
        },
        onSuccess: () => {
            message.success("View created");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employeeViews.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to create view");
        },
    });

    return { mutation };
};
