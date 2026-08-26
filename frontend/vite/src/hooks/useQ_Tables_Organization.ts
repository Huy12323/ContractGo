import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrganization = async (organizationId: string) => {
    const sb_FromOrganizations_Select = await supabase
        .from("organizations")
        .select("id, name, owner_id, created_at, updated_at")
        .eq("id", organizationId)
        .single();
    if (sb_FromOrganizations_Select.error) throw sb_FromOrganizations_Select.error;
    return sb_FromOrganizations_Select.data;
};

export type Tables_Organization_QueryData = Awaited<ReturnType<typeof fetchOrganization>>;

/**
 * The single-organization read. `useQ_Tables_MyOrganization` derives the current
 * org by `.find()`ing it out of the `get_my_member_organizations()` list, which
 * only carries `id` and `name` — so `owner_id`, `created_at` and `updated_at`
 * were fetched nowhere in the app. Anything that needs the row itself (the
 * settings dialog, and a rename that has to show through immediately) reads it
 * here instead.
 */
export const useQ_Tables_Organization = ({
    organizationId,
    enabled = true,
}: {
    organizationId: string;
    enabled?: boolean;
}) => {
    const query = useQuery({
        enabled: !!organizationId && enabled,
        queryKey: [...QueryKeys.organizations.record(organizationId)],
        queryFn: () => fetchOrganization(organizationId),
    });

    return { query, organization: query.data ?? null };
};
