import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import type { OrgRole } from "@/hooks/useQ_Tables_MyOrganization";

export type Org_Capabilities = {
    role: OrgRole | null;
    canManageTemplates: boolean;
    canSendDocuments: boolean;
};

const fetchMyCapabilities = async (organizationId: string): Promise<Org_Capabilities> => {
    const sb_RpcGetMyOrgCapabilities = await supabase.rpc("get_my_org_capabilities", {
        org_id: organizationId,
    });
    if (sb_RpcGetMyOrgCapabilities.error) throw sb_RpcGetMyOrgCapabilities.error;

    const data = sb_RpcGetMyOrgCapabilities.data as {
        role: OrgRole | null;
        can_manage_templates: boolean;
        can_send_documents: boolean;
    } | null;

    return {
        role: data?.role ?? null,
        canManageTemplates: data?.can_manage_templates === true,
        canSendDocuments: data?.can_send_documents === true,
    };
};

/**
 * What the current user may DO in this organization — the read side of CG-027.
 *
 * Distinct from `useQ_Tables_MyRole`, which answers what they ARE. Since CG-027
 * the tier alone no longer decides: a member may hold `can_send_documents`
 * without being an admin, so a page that hides its "New document" button on
 * `role === 'member'` hides it from the very people the feature exists for.
 * Anything gating an ACTION reads this hook; the five places that only label or
 * describe the person keep using `useQ_Tables_MyRole`.
 *
 * One RPC, not two. `get_my_org_capabilities` returns the role alongside the
 * flags precisely so a page never pays for both queries — `role` is exposed here
 * for the handful of callers that need to say "admins and owners" in copy.
 *
 * While loading, both flags read false. Every consumer therefore renders the
 * restricted view first and relaxes it, which is the safe direction: a control
 * that appears late is a flicker, one that appears and is then removed is a
 * button the user may already have clicked.
 */
export const useQ_Tables_MyCapabilities = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.organizations.record(organizationId), "capabilities"],
        queryFn: () => fetchMyCapabilities(organizationId),
    });

    return {
        query,
        role: query.data?.role ?? null,
        canManageTemplates: query.data?.canManageTemplates ?? false,
        canSendDocuments: query.data?.canSendDocuments ?? false,
    };
};
