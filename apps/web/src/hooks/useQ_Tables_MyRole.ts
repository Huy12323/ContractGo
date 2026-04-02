import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyRole = async (organizationId: string) => {
    const sb_RpcGetOrgRole = await supabase.rpc("get_org_role", { org_id: organizationId });
    if (sb_RpcGetOrgRole.error) throw sb_RpcGetOrgRole.error;
    return sb_RpcGetOrgRole.data as string | null;
};

export const useQ_Tables_MyRole = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "role"],
        queryFn: () => fetchMyRole(organizationId),
    });

    return { query, role: query.data ?? null };
};
