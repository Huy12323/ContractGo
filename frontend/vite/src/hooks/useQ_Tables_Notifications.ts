import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The signed-in user's notification inbox.
 *
 * No `user_id` filter and no `organizationId` requirement: RLS narrows this to
 * the caller's own rows, and passing a user id from the client would be a filter
 * the server does not trust anyway. `organizationId` is an optional NARROWING —
 * omitted, the query returns everything the user has, which is what the bell
 * shows on `/_protected/` where no organization is in scope.
 *
 * Rows with a NULL `organization_id` (an admin invitation, which arrives before
 * membership exists) are deliberately excluded by the org filter — inside an
 * organization they are not about that organization. They are still reachable
 * from the unfiltered view.
 */
const fetchNotifications = async (
    organizationId: string | null,
    unreadOnly: boolean,
    limit: number
) => {
    let sb_FromNotifications_Select = supabase
        .from("notifications")
        .select(
            "id, organization_id, type, title, body, link, request_id, metadata, read_at, emailed, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

    if (organizationId)
        sb_FromNotifications_Select = sb_FromNotifications_Select.eq(
            "organization_id",
            organizationId
        );
    if (unreadOnly) sb_FromNotifications_Select = sb_FromNotifications_Select.is("read_at", null);

    const { data, error } = await sb_FromNotifications_Select;
    if (error) throw error;
    return data;
};

export type Tables_Notifications_QueryData = Awaited<ReturnType<typeof fetchNotifications>>;
export type Tables_Notifications_Row = Tables_Notifications_QueryData[number];

export const useQ_Tables_Notifications = ({
    organizationId = null,
    unreadOnly = false,
    limit = 50,
    enabled = true,
}: {
    organizationId?: string | null;
    unreadOnly?: boolean;
    limit?: number;
    enabled?: boolean;
} = {}) => {
    const query = useQuery({
        enabled,
        // The `notifications` / `list` prefix is what the realtime fan-out in
        // `useSupabaseRealtimeSync` matches on, so every variant below is
        // invalidated by one event without enumerating them.
        queryKey: [...QueryKeys.notifications.list(), { organizationId, unreadOnly, limit }],
        queryFn: () => fetchNotifications(organizationId, unreadOnly, limit),
    });

    const notifications = useMemo(() => query.data || [], [query.data]);

    return { query, notifications };
};
