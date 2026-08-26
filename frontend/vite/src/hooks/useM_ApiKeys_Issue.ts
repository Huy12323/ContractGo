import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";
import type { Supabase_Enums } from "@/types/supabase.types";

export type ApiKey_Scope = Supabase_Enums<"api_keys_scopes_enum">;

export type UseM_ApiKeys_Issue_Body = {
    organizationId: string;
    name: string;
    scopes: ApiKey_Scope[];
    allowedEmbedOrigins: string[];
    expiresAt: string | null;
};

/**
 * Mints an API key and returns its PLAINTEXT exactly once.
 *
 * ⚠ THE RETURN VALUE IS A CREDENTIAL. `api_key_issue` stores only a sha256, so
 * the string this resolves with exists nowhere else and can never be recovered.
 * The caller must render it immediately and must not persist it — not to a
 * store, not to the query cache, not to `localStorage`. It is deliberately NOT
 * written into any query data here for that reason; the caller holds it in
 * component state that dies with the modal.
 *
 * ⚠ NEVER `.single()` ON THIS RPC. It WRITES, and PostgREST answers 406 on zero
 * rows by ROLLING THE TRANSACTION BACK — discarding the insert — while
 * supabase-js swallows the whole thing into `{data: null, error: null}`
 * (CG-043). A key would appear not to have been created while in fact... nothing
 * would have been created, which is the merciful version; the same pattern on a
 * different RPC silently loses a write. The array form is the only safe shape.
 *
 * NO REALTIME HALF TO THE HYBRID POLICY HERE, and that is a decision rather than
 * an omission. This project's realtime is an opt-in bus: a table gets events
 * only if a trigger INSERTs into `realtime_table_events`, and CG-044 added none.
 * Adding one would broadcast the existence, timing and row ids of credential
 * lifecycle events to EVERY ORG MEMBER, because that bus table's policy is
 * `org_members_can_view_realtime_table_events` — including the members who
 * cannot see this list at all. Explicit invalidation is therefore the whole
 * story for API keys, and a second tab learns about a new key when it refetches.
 */
export const useM_ApiKeys_Issue = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["api_keys", "issue"],
        mutationFn: async (body: UseM_ApiKeys_Issue_Body) => {
            const sb_RpcApiKeyIssue = await supabase.rpc("api_key_issue", {
                p_organization_id: body.organizationId,
                p_name: body.name,
                p_scopes: body.scopes,
                p_allowed_embed_origins: body.allowedEmbedOrigins,
                // `undefined` rather than `null` so the RPC's own DEFAULT
                // applies. Postgres named-argument defaults are skipped by
                // omission, and sending an explicit null would set the column to
                // null on purpose — which happens to be the same value here, but
                // would not be if the default ever changed.
                p_expires_at: body.expiresAt ?? undefined,
            });
            if (sb_RpcApiKeyIssue.error) throw sb_RpcApiKeyIssue.error;

            const issued = sb_RpcApiKeyIssue.data?.[0];
            if (!issued?.api_key) {
                throw new Error("The key was not created. Nothing was changed.");
            }
            return issued;
        },
        onSuccess: () => {
            // Deliberately no `message.success` — the reveal panel IS the
            // success state, and a toast sliding over the one and only showing
            // of a credential is the wrong thing to put on that screen.
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.api_keys.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to create the API key"));
        },
    });

    return { mutation };
};
