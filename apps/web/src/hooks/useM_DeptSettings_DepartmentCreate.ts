import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_DeptSettings_DepartmentCreate_Params = {
    name: string;
    entity_id: string;
    parent_id?: string;
};

export const useM_DeptSettings_DepartmentCreate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_DeptSettings_DepartmentCreate_Params) => {
            const sb_FromDepartments_Insert = await supabase
                .from("departments")
                .insert(body)
                .select()
                .single();
            if (sb_FromDepartments_Insert.error) throw sb_FromDepartments_Insert.error;
            return sb_FromDepartments_Insert.data;
        },
        onSuccess: () => {
            message.success("Department created");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to create department");
        },
    });

    return { mutation };
};
