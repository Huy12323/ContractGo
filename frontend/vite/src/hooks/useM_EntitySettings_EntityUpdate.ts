import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { Database } from "@/types/database.types";

export type UseM_EntitySettings_EntityUpdate_Params = { entityId: string };
export type UseM_EntitySettings_EntityUpdate_Body = Partial<{
    name: string;
    timezone: Database["public"]["Enums"]["iana_timezone"] | null;
    locale: string;
}>;

export const useM_EntitySettings_EntityUpdate = ({ entityId }: UseM_EntitySettings_EntityUpdate_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["entities", "update", entityId],
        mutationFn: async (body: UseM_EntitySettings_EntityUpdate_Body) => {
            const sb_FromEntities_Update = await supabase
                .from("entities")
                .update(body)
                .eq("id", entityId)
                .select()
                .single();
            if (sb_FromEntities_Update.error) throw sb_FromEntities_Update.error;
            return sb_FromEntities_Update.data;
        },
        onSuccess: () => {
            message.success("Entity updated");
            queryClient.invalidateQueries({ queryKey: QueryKeys.entities.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update entity");
        },
    });

    return { mutation };
};
