import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchInvitationByToken = async (invitationToken: string) => {
    const sb_FromOnboardingInvitations_Select = await supabase
        .from("onboarding_invitations")
        .select(
            "id, invitation_token, employee_email, status, prefilled_fields, created_at, organization_id, organizations(id, name), entity_id, entities(id, name), contract_template_id, contract_templates(id, name, layout), rel__department__invitation(department_id, departments(id, name))",
        )
        .eq("invitation_token", invitationToken)
        .maybeSingle();

    if (sb_FromOnboardingInvitations_Select.error)
        throw sb_FromOnboardingInvitations_Select.error;
    return sb_FromOnboardingInvitations_Select.data;
};

export type PageOnboardingFiller_InvitationByToken_QueryData = Awaited<
    ReturnType<typeof fetchInvitationByToken>
>;

export const useQ_PageOnboardingFiller_InvitationByToken = ({
    invitationToken,
}: {
    invitationToken: string;
}) => {
    const query = useQuery({
        enabled: !!invitationToken,
        queryKey: QueryKeys.onboardingInvitations.byToken(invitationToken),
        queryFn: () => fetchInvitationByToken(invitationToken),
    });

    return { query, invitation: query.data ?? null };
};
