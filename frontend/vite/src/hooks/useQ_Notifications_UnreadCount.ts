import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The number on the bell.
 *
 * A `head: true` count rather than fetching the rows and measuring the array:
 * this runs on every page in the app, and the partial index
 * `idx_notifications_user_id_unread` exists precisely for it. RLS supplies the
 * `user_id = auth.uid()` half of the predicate.
 *
 * NOT org-scoped, deliberately. The badge answers "is there anything for me",
 * and hiding a count because the user happens to be looking at a different
 * organization is how a notification goes unread forever.
 */
const fetchUnreadCount = async () => {
    const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
    if (error) throw error;
    return count ?? 0;
};

export const useQ_Notifications_UnreadCount = ({ enabled = true }: { enabled?: boolean } = {}) => {
    const query = useQuery({
        enabled,
        queryKey: [...QueryKeys.notifications.list(), "unread-count"],
        queryFn: fetchUnreadCount,
    });

    return { query, unreadCount: query.data ?? 0 };
};
