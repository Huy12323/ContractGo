import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// Every non-accepted invitation, not just the pending ones. The People page
// renders "Expired" as its own status and offers Resend on it, which it cannot
// do for a row it never fetched. Accepted invitations are excluded because the
// person is by then an admin or member row and would otherwise appear twice.
const fetchInvitations = async (organizationId: string) => {
    const sb_FromInvitations_Select = await supabase
        .from("invitations")
        .select("id, email, role, status, expires_at, created_at")
        .eq("organization_id", organizationId)
        .neq("status", "accepted")
        .order("created_at", { ascending: false });
    if (sb_FromInvitations_Select.error) throw sb_FromInvitations_Select.error;
    return sb_FromInvitations_Select.data;
};

export type Tables_Invitations_QueryData = Awaited<ReturnType<typeof fetchInvitations>>;

export const useQ_Tables_Invitations = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        // Keyed under the TABLE rather than the organization so the realtime
        // predicate can find it: it looks up `table_name` in the key and then
        // reads the next segment, so the "list" marker has to be adjacent.
        queryKey: [...QueryKeys.invitations.list(), organizationId],
        queryFn: () => fetchInvitations(organizationId),
    });

    const invitations = useMemo(() => query.data || [], [query.data]);

    return { query, invitations };
};
