import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgPermissions = async (organizationId: string) => {
    const sb_FromOrganizationRolePermissions_Select = await supabase
        .from("organization_role_permissions")
        .select("role, permission")
        .eq("organization_id", organizationId);
    if (sb_FromOrganizationRolePermissions_Select.error) throw sb_FromOrganizationRolePermissions_Select.error;
    return sb_FromOrganizationRolePermissions_Select.data;
};

export type Tables_OrgPermissions_QueryData = Awaited<ReturnType<typeof fetchOrgPermissions>>;

export const useQ_Tables_OrgPermissions = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "permissions"],
        queryFn: () => fetchOrgPermissions(organizationId),
    });

    const permissions = useMemo(() => query.data || [], [query.data]);

    return { query, permissions };
};
