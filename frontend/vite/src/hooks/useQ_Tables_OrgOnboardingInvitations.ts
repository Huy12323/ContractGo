import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchOrgOnboardingInvitations = async (organizationId: string) => {
    const sb_FromOnboardingInvitations_Select = await supabase
        .from("onboarding_invitations")
        .select(
            "id, invitation_token, employee_email, status, created_at, organization_id, entity_id, entities(id, name), contract_template_id, contract_templates(id, name), rel__department__invitation(department_id, departments(id, name)), contracts(id, status, signed_at, signature_path, approved_at, approved_by, employee_id)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

    if (sb_FromOnboardingInvitations_Select.error)
        throw sb_FromOnboardingInvitations_Select.error;
    return sb_FromOnboardingInvitations_Select.data;
};

export type Tables_OrgOnboardingInvitations_QueryData = Awaited<
    ReturnType<typeof fetchOrgOnboardingInvitations>
>;

export const useQ_Tables_OrgOnboardingInvitations = ({
    organizationId,
}: {
    organizationId: string;
}) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: QueryKeys.onboardingInvitations.org(organizationId),
        queryFn: () => fetchOrgOnboardingInvitations(organizationId),
    });

    const invitations = useMemo(() => query.data || [], [query.data]);

    return { query, invitations };
};
