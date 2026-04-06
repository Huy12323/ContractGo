import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_EntitySettings_EntityCreate_Params = {
    organization_id: string;
    name: string;
    timezone?: string;
    locale?: string;
};

export const useM_EntitySettings_EntityCreate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (body: UseM_EntitySettings_EntityCreate_Params) => {
            const sb_FromEntities_Insert = await supabase
                .from("entities")
                .insert(body)
                .select()
                .single();
            if (sb_FromEntities_Insert.error) throw sb_FromEntities_Insert.error;
            return sb_FromEntities_Insert.data;
        },
        onSuccess: () => {
            message.success("Entity created");
            queryClient.invalidateQueries({ queryKey: QueryKeys.entities.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to create entity");
        },
    });

    return { mutation };
};
