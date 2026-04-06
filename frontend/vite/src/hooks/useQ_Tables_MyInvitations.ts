import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyInvitations = async () => {
    const sb_Auth_GetUser = await supabase.auth.getUser();
    if (!sb_Auth_GetUser.data.user?.email) return [];

    const sb_FromOrgAdminInvitations_Select = await supabase
        .from("org_admin_invitations")
        .select("id, email, status, token, expires_at, created_at, organization_id, organizations(id, name)")
        .eq("status", "pending")
        .ilike("email", sb_Auth_GetUser.data.user.email)
        .order("created_at", { ascending: false });

    if (sb_FromOrgAdminInvitations_Select.error) throw sb_FromOrgAdminInvitations_Select.error;
    return sb_FromOrgAdminInvitations_Select.data;
};

export type Tables_MyInvitations_QueryData = Awaited<ReturnType<typeof fetchMyInvitations>>;

export const useQ_Tables_MyInvitations = () => {
    const query = useQuery({
        queryKey: QueryKeys.orgAdminInvitations.mine(),
        queryFn: fetchMyInvitations,
    });

    const invitations = useMemo(() => query.data || [], [query.data]);

    return { query, invitations };
};
