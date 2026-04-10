import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EmployeeColumn_Delete_Params = { columnId: string; onSuccess?: () => void };

export const useM_EmployeeColumn_Delete = ({ columnId, onSuccess }: UseM_EmployeeColumn_Delete_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employeeColumns", "delete", columnId],
        mutationFn: async () => {
            const sb_FromEmployeeColumns_Delete = await supabase
                .from("employee_columns")
                .delete()
                .eq("id", columnId);
            if (sb_FromEmployeeColumns_Delete.error) throw sb_FromEmployeeColumns_Delete.error;
        },
        onSuccess: () => {
            message.success("Field deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumns.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.employeeColumnChoices.all() });
            onSuccess?.();
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete field");
        },
    });

    return { mutation };
};
