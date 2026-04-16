import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMyOnboardingInvitations = async () => {
    const sb_Auth_GetUser = await supabase.auth.getUser();
    if (!sb_Auth_GetUser.data.user?.email) return [];

    const sb_FromOnboardingInvitations_Select = await supabase
        .from("onboarding_invitations")
        .select(
            "id, invitation_token, employee_email, status, created_at, organization_id, organizations(id, name), entity_id, entities(id, name), contract_template_id, contract_templates(id, name)",
        )
        .eq("status", "sent")
        .ilike("employee_email", sb_Auth_GetUser.data.user.email)
        .order("created_at", { ascending: false });

    if (sb_FromOnboardingInvitations_Select.error)
        throw sb_FromOnboardingInvitations_Select.error;
    return sb_FromOnboardingInvitations_Select.data;
};

export type Tables_MyOnboardingInvitations_QueryData = Awaited<
    ReturnType<typeof fetchMyOnboardingInvitations>
>;

export const useQ_Tables_MyOnboardingInvitations = () => {
    const query = useQuery({
        queryKey: [...QueryKeys.onboarding_invitations.list(), "mine"],
        queryFn: fetchMyOnboardingInvitations,
    });

    const invitations = useMemo(() => query.data || [], [query.data]);

    return { query, invitations };
};
