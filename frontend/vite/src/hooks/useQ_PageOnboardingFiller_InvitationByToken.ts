import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchInvitationByToken = async (invitationToken: string) => {
    const sb_FromOnboardingInvitations_Select = await supabase
        .from("onboarding_invitations")
        .select(
            "id, invitation_token, employee_email, status, prefilled_fields, hr_comments, created_at, organization_id, organizations(id, name), entity_id, entities(id, name), contract_template_id, contract_template_version_id, template_snapshot, contract_templates(id, name), contracts(id, status, field_values, prefilled_fields, signature_path), rel__department__invitation(department_id, departments(id, name))",
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
        queryKey: QueryKeys.onboarding_invitations.record(invitationToken),
        queryFn: () => fetchInvitationByToken(invitationToken),
        // Filler lives through a multi-round HR ↔ employee loop. Each navigation
        // into the filler must see the freshest invitation (new hr_comments, new
        // contract.status). Realtime invalidation covers same-page updates, but
        // route-in from home within staleTime would serve stale cache otherwise.
        refetchOnMount: "always",
    });

    return { query, invitation: query.data ?? null };
};
