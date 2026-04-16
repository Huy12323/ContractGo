import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_EmployeeColumn_Delete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employeeColumns", "delete"],
        mutationFn: async ({ columnId }: { columnId: string }) => {
            const sb_FromEmployeeColumns_Delete = await supabase
                .from("employee_columns")
                .delete()
                .eq("id", columnId);
            if (sb_FromEmployeeColumns_Delete.error) throw sb_FromEmployeeColumns_Delete.error;
        },
        onSuccess: () => {
            message.success("Field deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_columns.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete field");
        },
    });

    return { mutation };
};
