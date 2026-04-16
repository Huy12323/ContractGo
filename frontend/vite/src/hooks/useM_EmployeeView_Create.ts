import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type {
    EmployeeTable_FilterCondition,
    EmployeeTable_SortEntry,
    EmployeeTable_GroupEntry,
} from "@/types/employeeTable.types";
import type { Json } from "@/types/database.types";

export type UseM_EmployeeView_Create_Params = {
    organization_id: string;
    name: string;
    sort_order?: number;
    // Optional initial per-column values (falls through to column DB defaults when omitted)
    filter?: EmployeeTable_FilterCondition[] | Json;
    sort?: EmployeeTable_SortEntry[] | Json;
    group_by?: EmployeeTable_GroupEntry[] | Json;
    hidden_keys?: string[] | Json;
    field_order?: string[] | Json;
    field_widths?: Record<string, number> | Json;
};

export const useM_EmployeeView_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_EmployeeView_Create_Params) => {
            const sb_FromEmployeeViews_Insert = await supabase
                .from("employee_views")
                .insert(body as never)
                .select()
                .single();
            if (sb_FromEmployeeViews_Insert.error) throw sb_FromEmployeeViews_Insert.error;
            return sb_FromEmployeeViews_Insert.data;
        },
        onSuccess: () => {
            message.success("View created");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_views.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to create view");
        },
    });

    return { mutation };
};
