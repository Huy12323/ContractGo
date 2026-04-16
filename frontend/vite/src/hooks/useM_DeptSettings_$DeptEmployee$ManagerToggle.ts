import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_DeptSettings_$DeptEmployee$ManagerToggle_Params = { departmentId: string };
export type UseM_DeptSettings_$DeptEmployee$ManagerToggle_Body = {
    employeeId: string;
    is_manager: boolean;
};

export const useM_DeptSettings_$DeptEmployee$ManagerToggle = ({
    departmentId,
}: UseM_DeptSettings_$DeptEmployee$ManagerToggle_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["rel__department__employee", "manager_toggle", departmentId],
        mutationFn: async (body: UseM_DeptSettings_$DeptEmployee$ManagerToggle_Body) => {
            const sb_FromRelDepartmentEmployee_Update = await supabase
                .from("rel__department__employee")
                .update({ is_manager: body.is_manager })
                .eq("department_id", departmentId)
                .eq("employee_id", body.employeeId)
                .select()
                .single();
            if (sb_FromRelDepartmentEmployee_Update.error) throw sb_FromRelDepartmentEmployee_Update.error;
            return sb_FromRelDepartmentEmployee_Update.data;
        },
        onSuccess: (_data, variables) => {
            message.success(variables.is_manager ? "Promoted to manager" : "Removed as manager");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update manager role");
        },
    });

    return { mutation };
};
