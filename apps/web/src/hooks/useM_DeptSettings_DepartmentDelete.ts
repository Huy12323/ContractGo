import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_DeptSettings_DepartmentDelete = ({ departmentId, onSuccess: onSuccessCallback }: { departmentId: string; onSuccess?: () => void }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async () => {
            const sb_FromDepartments_Delete = await supabase
                .from("departments")
                .delete()
                .eq("id", departmentId);
            if (sb_FromDepartments_Delete.error) throw sb_FromDepartments_Delete.error;
        },
        onSuccess: () => {
            message.success("Department deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() });
            onSuccessCallback?.();
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete department");
        },
    });

    return { mutation };
};
