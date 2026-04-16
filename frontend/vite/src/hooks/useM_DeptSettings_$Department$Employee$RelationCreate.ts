import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_DeptSettings_$Department$Employee$RelationCreate_Params = {
    departmentId: string;
};

export type UseM_DeptSettings_$Department$Employee$RelationCreate_Body = {
    employee_id: string;
};

export const useM_DeptSettings_$Department$Employee$RelationCreate = ({
    departmentId,
}: UseM_DeptSettings_$Department$Employee$RelationCreate_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["rel__department__employee", "create", departmentId],
        mutationFn: async (body: UseM_DeptSettings_$Department$Employee$RelationCreate_Body) => {
            const sb_FromRelDepartmentEmployee_Insert = await supabase
                .from("rel__department__employee")
                .insert({
                    department_id: departmentId,
                    employee_id: body.employee_id,
                    is_manager: false,
                })
                .select()
                .single();
            if (sb_FromRelDepartmentEmployee_Insert.error) throw sb_FromRelDepartmentEmployee_Insert.error;
            return sb_FromRelDepartmentEmployee_Insert.data;
        },
        onSuccess: () => {
            message.success("Employee added to department");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to add employee to department");
        },
    });

    return { mutation };
};
