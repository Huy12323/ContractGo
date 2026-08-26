import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Notification_MarkRead_Params = {
    id: string;
    /** `false` un-reads it — the same write, and the same guard trigger allows it. */
    read?: boolean;
};

/**
 * Marks one notification read.
 *
 * No RPC: the UPDATE policy plus `notifications_guard_user_update` already say
 * exactly what a recipient may do to their own row, which is set `read_at` and
 * nothing else. A function would only restate that in a second place.
 *
 * NO TOAST. Every other mutation in this app reports itself because the user
 * asked for something; this one fires as a side effect of clicking through to a
 * document, and a "Marked as read" message on the way out is noise.
 */
export const useM_Notification_MarkRead = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: async ({ id, read = true }: UseM_Notification_MarkRead_Params) => {
            const sb_FromNotifications_Update = await supabase
                .from("notifications")
                .update({ read_at: read ? new Date().toISOString() : null })
                .eq("id", id)
                .select("id, read_at")
                .single();
            if (sb_FromNotifications_Update.error) throw sb_FromNotifications_Update.error;
            return sb_FromNotifications_Update.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.notifications.all() });
        },
        onError: (err) => {
            console.error(err);
        },
    });

    return { mutation };
};
