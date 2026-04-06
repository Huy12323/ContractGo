import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_EntitySettings_EntityEmployeeAdd = ({ entityId }: { entityId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (userId: string) => {
            const sb_FromEntityEmployees_Insert = await supabase
                .from("entity_employees")
                .insert({ entity_id: entityId, user_id: userId })
                .select()
                .single();
            if (sb_FromEntityEmployees_Insert.error) throw sb_FromEntityEmployees_Insert.error;
            return sb_FromEntityEmployees_Insert.data;
        },
        onSuccess: () => {
            message.success("Employee added to entity");
            queryClient.invalidateQueries({ queryKey: QueryKeys.entities.record(entityId) });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to add employee");
        },
    });

    return { mutation };
};
