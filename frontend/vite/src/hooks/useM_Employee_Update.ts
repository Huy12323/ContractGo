import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Employee_Update_Body = {
    employeeId: string;
    patch: Record<string, unknown>;
};

export const useM_Employee_Update = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employees", "update"],
        mutationFn: async ({ employeeId, patch }: UseM_Employee_Update_Body) => {
            // Dynamic columns live as real PG columns keyed by `employee_columns.id` (UUID),
            // so an arbitrary Record<string, unknown> patch is the natural shape.
            // Cast: generated types don't know about runtime-added dynamic columns.
            const sb_FromEmployees_Update = await supabase
                .from("employees")
                .update(patch as never)
                .eq("id", employeeId)
                .select()
                .single();
            if (sb_FromEmployees_Update.error) throw sb_FromEmployees_Update.error;
            return sb_FromEmployees_Update.data;
        },
        onSuccess: () => {
            message.success("Employee updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employees.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update employee");
        },
    });

    return { mutation };
};
