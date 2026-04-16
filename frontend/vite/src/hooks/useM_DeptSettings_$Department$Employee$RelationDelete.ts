import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_DeptSettings_$Department$Employee$RelationDelete_Params = {
    departmentId: string;
};

export type UseM_DeptSettings_$Department$Employee$RelationDelete_Body = {
    employee_id: string;
};

export const useM_DeptSettings_$Department$Employee$RelationDelete = ({
    departmentId,
}: UseM_DeptSettings_$Department$Employee$RelationDelete_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["rel__department__employee", "delete", departmentId],
        mutationFn: async (body: UseM_DeptSettings_$Department$Employee$RelationDelete_Body) => {
            const sb_FromRelDepartmentEmployee_Delete = await supabase
                .from("rel__department__employee")
                .delete()
                .eq("department_id", departmentId)
                .eq("employee_id", body.employee_id);
            if (sb_FromRelDepartmentEmployee_Delete.error) throw sb_FromRelDepartmentEmployee_Delete.error;
        },
        onSuccess: () => {
            message.success("Employee removed from department");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to remove employee from department");
        },
    });

    return { mutation };
};
