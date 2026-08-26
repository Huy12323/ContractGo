import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { AVATAR_FILE_SELECT } from "@/utils/Utils_Avatar_Src";
import { QueryKeys } from "@/utils/query/queryKeys";

// The owner is the one tier with no membership row — it is a column on
// `organizations` — so the People page has to fetch them separately or leave a
// hole where the most privileged person in the organization should be.
const fetchOrganizationOwner = async (organizationId: string) => {
    const sb_FromOrganizations_Select = await supabase
        .from("organizations")
        .select(
            `id, owner_id, profiles:owner_id (id, full_name, email, avatar_url, ${AVATAR_FILE_SELECT})`
        )
        .eq("id", organizationId)
        .maybeSingle();
    if (sb_FromOrganizations_Select.error) throw sb_FromOrganizations_Select.error;
    return sb_FromOrganizations_Select.data;
};

export type Tables_OrganizationOwner_QueryData = Awaited<ReturnType<typeof fetchOrganizationOwner>>;

export const useQ_Tables_OrganizationOwner = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "owner"],
        queryFn: () => fetchOrganizationOwner(organizationId),
    });

    return { query, owner: query.data ?? null };
};
