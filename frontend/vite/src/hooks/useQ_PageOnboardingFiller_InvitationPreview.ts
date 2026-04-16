import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchInvitationPreview = async (invitationToken: string) => {
    const sb_FunctionsGetInvitationPreview_Rpc = await supabase.rpc(
        "get_invitation_preview",
        { p_token: invitationToken },
    );
    if (sb_FunctionsGetInvitationPreview_Rpc.error)
        throw sb_FunctionsGetInvitationPreview_Rpc.error;
    return sb_FunctionsGetInvitationPreview_Rpc.data?.[0] ?? null;
};

export type PageOnboardingFiller_InvitationPreview_QueryData = Awaited<
    ReturnType<typeof fetchInvitationPreview>
>;

export const useQ_PageOnboardingFiller_InvitationPreview = ({
    invitationToken,
    enabled,
}: {
    invitationToken: string;
    enabled: boolean;
}) => {
    const query = useQuery({
        enabled: !!invitationToken && enabled,
        queryKey: QueryKeys.onboardingInvitations.preview(invitationToken),
        queryFn: () => fetchInvitationPreview(invitationToken),
    });

    return { query, preview: query.data ?? null };
};
