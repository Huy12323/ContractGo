import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_Notifications_MarkAllRead_Params = {
    /** Narrow to one organization; omit to clear the whole inbox. */
    organizationId?: string | null;
};

/**
 * Clears the badge.
 *
 * This one IS an RPC, unlike `useM_Notification_MarkRead`. A client-side bulk
 * `update(...).is("read_at", null)` works under RLS but returns no count, and
 * org-scoping it would mean the server trusting a filter the client supplied.
 * `notifications_mark_all_read` reads `auth.uid()` itself and returns how many
 * rows it actually flipped, which is what the toast reports.
 */
export const useM_Notifications_MarkAllRead = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async ({
            organizationId = null,
        }: UseM_Notifications_MarkAllRead_Params = {}) => {
            const sb_RpcNotificationsMarkAllRead = await supabase.rpc(
                "notifications_mark_all_read",
                {
                    // `undefined` omits the argument so Postgres applies the
                    // function's own DEFAULT NULL; passing an explicit null through
                    // PostgREST is not the same call.
                    p_organization_id: organizationId ?? undefined,
                }
            );
            if (sb_RpcNotificationsMarkAllRead.error) throw sb_RpcNotificationsMarkAllRead.error;
            return sb_RpcNotificationsMarkAllRead.data ?? 0;
        },
        onSuccess: (count) => {
            // Silent when there was nothing to do: the button is reachable with
            // an empty inbox, and "0 notifications marked as read" is a toast
            // that reports the absence of an action.
            if (count > 0)
                message.success(`${count} notification${count === 1 ? "" : "s"} marked as read`);
            queryClient.invalidateQueries({ queryKey: QueryKeys.notifications.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to mark notifications as read");
        },
    });

    return { mutation };
};
