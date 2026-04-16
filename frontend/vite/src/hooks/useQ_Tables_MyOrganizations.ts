import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyOrganizations = async () => {
    const sb_RpcGetMyMemberOrganizations = await supabase.rpc("get_my_member_organizations");
    if (sb_RpcGetMyMemberOrganizations.error) throw sb_RpcGetMyMemberOrganizations.error;
    return sb_RpcGetMyMemberOrganizations.data;
};

export type Tables_MyOrganizations_QueryData = Awaited<ReturnType<typeof fetchMyOrganizations>>;

export const useQ_Tables_MyOrganizations = () => {
    const query = useQuery({
        queryKey: [...QueryKeys.organizations.list(), "mine"],
        queryFn: fetchMyOrganizations,
    });

    const organizations = useMemo(() => query.data || [], [query.data]);

    return { query, organizations };
};
