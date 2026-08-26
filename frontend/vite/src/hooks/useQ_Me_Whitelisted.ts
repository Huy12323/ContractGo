import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { QueryKeys } from "@/utils/query/queryKeys";

// CG-035. Was an `is_whitelisted()` RPC — `public.whitelist` has RLS on and no
// policies, so the roster itself is still unreadable and that has not changed.
// What changed is that the one-bit ANSWER now lives on the caller's own profile
// row, materialized by trigger, so it can be read through the ordinary profiles
// SELECT policy instead of a bespoke function call.
//
// The column is read-only to clients: CG-035 revokes UPDATE on it at column level,
// so a user cannot approve themselves by writing the row this hook reads.
const fetchIsWhitelisted = async (userId: string) => {
    const sb_FromProfiles_Select = await supabase
        .from("profiles")
        .select("whitelist")
        .eq("id", userId)
        .single();

    if (sb_FromProfiles_Select.error) throw sb_FromProfiles_Select.error;
    return sb_FromProfiles_Select.data.whitelist;
};

export const useQ_Me_Whitelisted = () => {
    const user = useStore_Auth_User();

    const query = useQuery({
        enabled: !!user,
        // Keyed by user id so switching accounts in the same tab cannot read the
        // previous account's verdict out of the cache.
        queryKey: QueryKeys.whitelist.record(user?.id ?? ""),
        queryFn: () => fetchIsWhitelisted(user?.id ?? ""),
        // Approval happens out of band, in Studio. A cached "no" that outlives
        // the operator's INSERT is exactly the case the pending-access screen's
        // "Check again" button exists to break, so keep nothing stale.
        staleTime: 0,
    });

    return { query, whitelisted: query.data ?? false };
};
