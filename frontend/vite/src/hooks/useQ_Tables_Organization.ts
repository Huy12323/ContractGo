import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { ORGANIZATION_LOGO_SELECT } from "@/utils/Utils_Files_PublicUrl";

/**
 * Every settings-writable column, named once.
 *
 * CG-050 gave `organizations` nine settable columns across three tabs, and all
 * three tabs read them from this one query. Spelled out as a const in the spirit
 * of `AVATAR_FILE_SELECT` so the tabs cannot drift into three slightly different
 * selects — and so that adding a column means editing one string, not three.
 */
const ORGANIZATION_SETTINGS_SELECT = `id, name, owner_id, created_at, updated_at, is_personal,
    ai_assistant_enabled, timezone, brand_color, email_sender_name, logo_file_id,
    default_expiry_days, default_reminder_days, default_signer_auth,
    ${ORGANIZATION_LOGO_SELECT}` as const;

const fetchOrganization = async (organizationId: string) => {
    const sb_FromOrganizations_Select = await supabase
        .from("organizations")
        .select(ORGANIZATION_SETTINGS_SELECT)
        .eq("id", organizationId)
        .single();
    if (sb_FromOrganizations_Select.error) throw sb_FromOrganizations_Select.error;
    return sb_FromOrganizations_Select.data;
};

export type Tables_Organization_QueryData = Awaited<ReturnType<typeof fetchOrganization>>;

/**
 * The single-organization read. `useQ_Tables_MyOrganization` derives the current
 * org by `.find()`ing it out of the `get_my_member_organizations()` list, which
 * only carries `id` and `name` — so everything else was fetched nowhere in the
 * app. Anything that needs the row itself reads it here instead.
 *
 * Since CG-050 that is the General, Branding and Documents tabs, all three of
 * which share this single query and the single `useM_OrgSettings_OrganizationUpdate`
 * mutation beside it: same row, same RLS, same invalidation.
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
