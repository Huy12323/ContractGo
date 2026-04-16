import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type {
    EmployeeTable_FilterCondition,
    EmployeeTable_SortEntry,
    EmployeeTable_GroupEntry,
} from "@/types/employeeTable.types";

export type UseM_EmployeeView_Update_Body = {
    viewId: string;
    name?: string;
    filter?: EmployeeTable_FilterCondition[];
    sort?: EmployeeTable_SortEntry[];
    group_by?: EmployeeTable_GroupEntry[];
    hidden_keys?: string[];
    field_order?: string[];
    field_widths?: Record<string, number>;
};

export const useM_EmployeeView_Update = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({ viewId, ...patch }: UseM_EmployeeView_Update_Body) => {
            // Cast: FilterCondition.value is `unknown` which doesn't narrow to Json; the DB accepts any JSONB.
            const sb_FromEmployeeViews_Update = await supabase
                .from("employee_views")
                .update(patch as never)
                .eq("id", viewId)
                .select()
                .single();
            if (sb_FromEmployeeViews_Update.error) throw sb_FromEmployeeViews_Update.error;
            return sb_FromEmployeeViews_Update.data;
        },
        onSuccess: (_data, body) => {
            // Silent for auto-save config patches. Only toast on rename (name-only patch).
            const isRenameOnly = body.name !== undefined
                && body.filter === undefined
                && body.sort === undefined
                && body.group_by === undefined
                && body.hidden_keys === undefined
                && body.field_order === undefined
                && body.field_widths === undefined;
            if (isRenameOnly) {
                message.success("View renamed");
            }
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_views.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update view");
        },
    });

    return { mutation };
};
