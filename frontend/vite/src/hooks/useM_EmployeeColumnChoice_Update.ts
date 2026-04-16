import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EmployeeColumnChoice_Update_Params = { choiceId: string };
export type UseM_EmployeeColumnChoice_Update_Body = Partial<{ label: string; sort_order: number }>;

export const useM_EmployeeColumnChoice_Update = ({ choiceId }: UseM_EmployeeColumnChoice_Update_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["employeeColumnChoices", "update", choiceId],
        mutationFn: async (body: UseM_EmployeeColumnChoice_Update_Body) => {
            const sb_FromEmployeeColumnChoices_Update = await supabase
                .from("employee_column_choices")
                .update(body)
                .eq("id", choiceId)
                .select()
                .single();
            if (sb_FromEmployeeColumnChoices_Update.error) throw sb_FromEmployeeColumnChoices_Update.error;
            return sb_FromEmployeeColumnChoices_Update.data;
        },
        onSuccess: () => {
            message.success("Choice updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update choice");
        },
    });

    return { mutation };
};
