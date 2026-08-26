import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { AVATAR_FILE_SELECT } from "@/utils/Utils_Avatar_Src";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMe = async () => {
    const sb_Auth_GetUser = await supabase.auth.getUser();
    if (!sb_Auth_GetUser.data.user) throw new Error("Not authenticated");

    const sb_FromProfiles_Select = await supabase
        .from("profiles")
        .select(
            `id, email, full_name, avatar_url, email_verified, whitelist, created_at, updated_at, ${AVATAR_FILE_SELECT}`
        )
        .eq("id", sb_Auth_GetUser.data.user.id)
        .single();

    if (sb_FromProfiles_Select.error) throw sb_FromProfiles_Select.error;
    return sb_FromProfiles_Select.data;
};

export type Me_QueryData = Awaited<ReturnType<typeof fetchMe>>;

export const useQ_Me = () => {
    const user = useStore_Auth_User();
    const userId = user?.id ?? "";
    const query = useQuery({
        enabled: !!userId,
        queryKey: QueryKeys.profiles.record(userId),
        queryFn: fetchMe,
    });

    return { query, profile: query.data ?? null };
};
