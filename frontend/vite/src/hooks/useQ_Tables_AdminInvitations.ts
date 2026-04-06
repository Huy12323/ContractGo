import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchAdminInvitations = async (organizationId: string) => {
    const sb_FromAdminInvitations_Select = await supabase
        .from("admin_invitations")
        .select("id, email, status, token, expires_at, created_at")
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
    if (sb_FromAdminInvitations_Select.error) throw sb_FromAdminInvitations_Select.error;
    return sb_FromAdminInvitations_Select.data;
};

export type Tables_AdminInvitations_QueryData = Awaited<ReturnType<typeof fetchAdminInvitations>>;

export const useQ_Tables_AdminInvitations = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "invitations"],
        queryFn: () => fetchAdminInvitations(organizationId),
    });

    const invitations = useMemo(() => query.data || [], [query.data]);

    return { query, invitations };
};
