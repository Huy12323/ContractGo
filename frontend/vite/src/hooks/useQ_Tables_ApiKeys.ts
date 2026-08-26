import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * The organization's API keys — CG-044.
 *
 * ⚠ THROUGH THE RPC, NEVER THE TABLE. `api_keys` has RLS on with ZERO policies,
 * so a `.from("api_keys")` query cannot return a row at all — but the reason to
 * go through `api_keys_list` is not that the direct query fails. It is that the
 * RPC is admin-gated and **never selects `key_hash`**, so the credential digest
 * cannot reach a browser even by accident. `queryKeys.ts` spells this out at the
 * `api_keys` entry precisely because a later reader is likely to "fix" this into
 * a table query.
 *
 * A NON-ADMIN GETS AN EMPTY LIST, NOT AN ERROR. That is the RPC's own
 * behaviour (the `signature_verify_chain_for_member` shape) and this hook does
 * not dress it up: the page renders an empty state, which is the honest view for
 * someone who may not see these. The page ALSO hides the surface behind the same
 * role check, so this is the second of two gates rather than the only one.
 */
const fetchApiKeys = async (organizationId: string) => {
    const sb_RpcApiKeysList = await supabase.rpc("api_keys_list", {
        p_organization_id: organizationId,
    });
    if (sb_RpcApiKeysList.error) throw sb_RpcApiKeysList.error;
    return sb_RpcApiKeysList.data ?? [];
};

export type Tables_ApiKeys_QueryData = Awaited<ReturnType<typeof fetchApiKeys>>;
export type Tables_ApiKeys_Row = Tables_ApiKeys_QueryData[number];

export const useQ_Tables_ApiKeys = ({ organizationId }: { organizationId: string }) => {
    const query = useQuery({
        enabled: !!organizationId,
        // The list shape reserved by CG-044's `queryKeys.ts` entry. Keyed under
        // the table name so it matches the realtime predicate's positions even
        // though nothing emits for this table — see the note in
        // `useM_ApiKeys_Issue`.
        queryKey: [...QueryKeys.api_keys.list(), organizationId],
        queryFn: () => fetchApiKeys(organizationId),
    });

    const apiKeys = useMemo(() => query.data ?? [], [query.data]);

    /**
     * A key is LIVE when it is neither revoked nor past its expiry.
     *
     * Derived here rather than stored, and derived from BOTH columns, because
     * the two are different facts an admin needs told apart: a revoked key was
     * switched off by a person, an expired one simply ran out. The table shows
     * which; this flag is only for counting and for the sort.
     */
    const liveCount = useMemo(
        () =>
            apiKeys.filter(
                (k) => !k.revoked_at && (!k.expires_at || Date.parse(k.expires_at) > Date.now())
            ).length,
        [apiKeys]
    );

    return { query, apiKeys, liveCount };
};
