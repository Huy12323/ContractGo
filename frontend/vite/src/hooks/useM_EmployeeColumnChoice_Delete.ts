import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EmployeeColumnChoice_Delete_Params = { choiceId: string };

export const useM_EmployeeColumnChoice_Delete = ({ choiceId }: UseM_EmployeeColumnChoice_Delete_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employeeColumnChoices", "delete", choiceId],
        mutationFn: async () => {
            const sb_FromEmployeeColumnChoices_Delete = await supabase
                .from("employee_column_choices")
                .delete()
                .eq("id", choiceId);
            if (sb_FromEmployeeColumnChoices_Delete.error) throw sb_FromEmployeeColumnChoices_Delete.error;
        },
        onSuccess: () => {
            message.success("Choice deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete choice");
        },
    });

    return { mutation };
};
