import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

const fetchProfiles = async () => {
    const sb_FromProfiles_Select = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
    if (sb_FromProfiles_Select.error) throw sb_FromProfiles_Select.error;
    return sb_FromProfiles_Select.data;
};

export type Tables_Profiles_QueryData = Awaited<ReturnType<typeof fetchProfiles>>;

export const useQ_Tables_Profiles = () => {
    const query = useQuery({
        queryKey: QueryKeys.profiles.list(),
        queryFn: fetchProfiles,
    });

    const profiles = useMemo(() => query.data || [], [query.data]);

    return { query, profiles };
};
