import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_EntitySettings_EntityEmployeeRemove = ({ entityId }: { entityId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (entityEmployeeId: string) => {
            const sb_FromEntityEmployees_Delete = await supabase
                .from("entity_employees")
                .delete()
                .eq("id", entityEmployeeId);
            if (sb_FromEntityEmployees_Delete.error) throw sb_FromEntityEmployees_Delete.error;
        },
        onSuccess: () => {
            message.success("Employee removed from entity");
            queryClient.invalidateQueries({ queryKey: QueryKeys.entities.record(entityId) });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to remove employee");
        },
    });

    return { mutation };
};
