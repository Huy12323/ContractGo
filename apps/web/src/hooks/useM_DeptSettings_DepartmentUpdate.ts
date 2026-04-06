import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_DeptSettings_DepartmentUpdate = ({ departmentId }: { departmentId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["departments", "update", departmentId],
        mutationFn: async (body: { name: string }) => {
            const sb_FromDepartments_Update = await supabase
                .from("departments")
                .update(body)
                .eq("id", departmentId)
                .select()
                .single();
            if (sb_FromDepartments_Update.error) throw sb_FromDepartments_Update.error;
            return sb_FromDepartments_Update.data;
        },
        onSuccess: () => {
            message.success("Department updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update department");
        },
    });

    return { mutation };
};
