import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_EntitySettings_EntityDelete = ({ entityId, onSuccess: onSuccessCallback }: { entityId: string; onSuccess?: () => void }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async () => {
            const sb_FromEntities_Delete = await supabase
                .from("entities")
                .delete()
                .eq("id", entityId);
            if (sb_FromEntities_Delete.error) throw sb_FromEntities_Delete.error;
        },
        onSuccess: () => {
            message.success("Entity deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.entities.all() });
            onSuccessCallback?.();
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to delete entity");
        },
    });

    return { mutation };
};
