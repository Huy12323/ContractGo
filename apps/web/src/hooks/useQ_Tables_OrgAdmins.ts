import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgAdmins = async (organizationId: string) => {
    const sb_FromOrgAdmins_Select = await supabase
        .from("org_admins")
        .select("id, user_id, created_at, profiles(id, full_name, email, avatar_url)")
        .eq("organization_id", organizationId);
    if (sb_FromOrgAdmins_Select.error) throw sb_FromOrgAdmins_Select.error;
    return sb_FromOrgAdmins_Select.data;
};

export type Tables_OrgAdmins_QueryData = Awaited<ReturnType<typeof fetchOrgAdmins>>;

export const useQ_Tables_OrgAdmins = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "admins"],
        queryFn: () => fetchOrgAdmins(organizationId),
    });

    const admins = useMemo(() => query.data || [], [query.data]);

    return { query, admins };
};
