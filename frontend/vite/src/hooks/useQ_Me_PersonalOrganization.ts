import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * CG-048. The caller's personal workspace id, or null if they have never opened
 * one.
 *
 * READ-ONLY ON PURPOSE — it does NOT call `ensure_personal_organization`. That
 * RPC provisions, and this hook is used by the notification bell, which renders
 * on every page for every user. Provisioning as a side effect of rendering a
 * list would create a workspace for accounts that never asked for one, and would
 * move the moment of creation somewhere no one would think to look for it.
 * Provisioning stays where CG-048 put it: the `/me` route's `beforeLoad`.
 *
 * A null answer is a correct answer, not a missing one. If the workspace does
 * not exist then no personal envelope exists either, so every id the caller can
 * see belongs to a real organization — which is exactly what the callers below
 * need to decide.
 *
 * RLS does the filtering. `organizations` SELECT is `is_org_member(id)`, and a
 * personal workspace has no `admins` and no `members` rows by construction, so
 * `is_personal` can only ever match a row this user owns. The partial unique
 * index `idx_organizations_personal_owner` is what makes `.maybeSingle()` safe.
 */
const fetchMyPersonalOrganization = async () => {
    const sb_FromOrganizations_Select = await supabase
        .from("organizations")
        .select("id")
        .eq("is_personal", true)
        .maybeSingle();
    if (sb_FromOrganizations_Select.error) throw sb_FromOrganizations_Select.error;
    return sb_FromOrganizations_Select.data?.id ?? null;
};

export type Me_PersonalOrganization_QueryData = Awaited<
    ReturnType<typeof fetchMyPersonalOrganization>
>;

export const useQ_Me_PersonalOrganization = () => {
    const query = useQuery({
        queryKey: [...QueryKeys.organizations.list(), "personal"],
        queryFn: fetchMyPersonalOrganization,
    });

    return { query, personalOrganizationId: query.data ?? null };
};
