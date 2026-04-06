import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchMe = async () => {
    const sb_Auth_GetUser = await supabase.auth.getUser();
    if (!sb_Auth_GetUser.data.user) throw new Error("Not authenticated");

    const sb_FromProfiles_Select = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sb_Auth_GetUser.data.user.id)
        .single();

    if (sb_FromProfiles_Select.error) throw sb_FromProfiles_Select.error;
    return sb_FromProfiles_Select.data;
};

export type Me_QueryData = Awaited<ReturnType<typeof fetchMe>>;

export const useQ_Me = () => {
    const query = useQuery({
        queryKey: QueryKeys.profiles.me(),
        queryFn: fetchMe,
    });

    return { query, profile: query.data ?? null };
};
