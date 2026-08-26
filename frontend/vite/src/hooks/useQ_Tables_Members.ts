import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { AVATAR_FILE_SELECT } from "@/utils/Utils_Avatar_Src";
import { QueryKeys } from "@/utils/query/queryKeys";

// `members.email` is the address the invitation was sent to and is populated by
// `accept_invitation`; the profile join supplies the display name and avatar,
// which only exist once the person has filled them in.
const fetchMembers = async (organizationId: string) => {
    const sb_FromMembers_Select = await supabase
        .from("members")
        .select(
            `id, user_id, email, created_at, can_manage_templates, can_send_documents, profiles(id, full_name, email, avatar_url, ${AVATAR_FILE_SELECT})`
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
    if (sb_FromMembers_Select.error) throw sb_FromMembers_Select.error;
    return sb_FromMembers_Select.data;
};

export type Tables_Members_QueryData = Awaited<ReturnType<typeof fetchMembers>>;

export const useQ_Tables_Members = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        queryKey: [...QueryKeys.members.list(), organizationId],
        queryFn: () => fetchMembers(organizationId),
    });

    const members = useMemo(() => query.data || [], [query.data]);

    return { query, members };
};
