import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { useStore_Auth_User } from "@/stores/Store_Auth";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The signed-in user's saved signature library (CG-029).
 *
 * No `user_id` filter in the query. `user_signatures` is owner-only for SELECT,
 * so RLS returns exactly this user's rows and adding `.eq("user_id", …)` would
 * state the same restriction in a second, weaker place. The user id is still
 * needed for the query KEY — two accounts in the same browser tab must not share
 * a cache entry.
 *
 * Ordering is `is_default` first so the default is always `signatures[0]`, which
 * is what the signing screen preselects.
 */
const fetchMySignatures = async () => {
    const sb_FromUserSignatures_Select = await supabase
        .from("user_signatures")
        .select("id, name, r2_key, capture_method, is_default, created_at")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

    if (sb_FromUserSignatures_Select.error) throw sb_FromUserSignatures_Select.error;
    return sb_FromUserSignatures_Select.data;
};

export type Tables_MySignatures_QueryData = Awaited<ReturnType<typeof fetchMySignatures>>;
export type Tables_MySignatures_Row = Tables_MySignatures_QueryData[number];

export const useQ_Tables_MySignatures = () => {
    const user = useStore_Auth_User();
    const userId = user?.id ?? "";

    const query = useQuery({
        enabled: !!userId,
        queryKey: [...QueryKeys.user_signatures.list(), userId],
        queryFn: fetchMySignatures,
    });

    const signatures = useMemo(() => query.data ?? [], [query.data]);
    const defaultSignature = useMemo(
        () => signatures.find((s) => s.is_default) ?? null,
        [signatures]
    );

    return { query, signatures, defaultSignature };
};
