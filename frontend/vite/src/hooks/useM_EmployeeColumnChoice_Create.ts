import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EmployeeColumnChoice_Create_Params = {
    entity_id: string;
    employee_column_id: string;
    label: string;
    sort_order?: number;
};

export const useM_EmployeeColumnChoice_Create = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_EmployeeColumnChoice_Create_Params) => {
            const sb_FromEmployeeColumnChoices_Insert = await supabase
                .from("employee_column_choices")
                .insert(body)
                .select()
                .single();
            if (sb_FromEmployeeColumnChoices_Insert.error) throw sb_FromEmployeeColumnChoices_Insert.error;
            return sb_FromEmployeeColumnChoices_Insert.data;
        },
        onSuccess: () => {
            message.success("Choice added");
            queryClient.invalidateQueries({ queryKey: QueryKeys.employee_column_choices.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to add choice");
        },
    });

    return { mutation };
};
