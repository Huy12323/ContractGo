import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";
import type { Supabase_Enums } from "@/types/supabase.types";

export type Webhook_Event = Supabase_Enums<"webhook_endpoints_events_enum">;

export type UseM_Webhooks_Create_Body = {
    organizationId: string;
    name: string;
    url: string;
    events: Webhook_Event[];
};

/**
 * Registers an endpoint and returns its signing secret exactly once.
 *
 * ⚠ THE RETURN VALUE IS A CREDENTIAL, like `useM_ApiKeys_Issue`'s — but the
 * consequence of losing it is different and worth stating. An API key that is
 * lost can be revoked and replaced with no visible effect on anyone. A signing
 * secret that is lost means the receiving end can no longer verify what it is
 * being sent, and the only remedy is `webhook_endpoint_rotate_secret`, which
 * BREAKS DELIVERY until the consumer is updated. So the reveal panel says so.
 *
 * ⚠ NEVER `.single()` — `webhook_endpoint_create` writes, and PostgREST's 406
 * on zero rows rolls the transaction back while supabase-js reports
 * `{data: null, error: null}` (CG-043).
 *
 * The `https://` requirement is a CHECK constraint on the table, not a client
 * validation. The form checks too, so the refusal is immediate and legible — but
 * the constraint is what makes it true for every caller, and a `http://` URL
 * that slipped past the form is refused by the database rather than accepted.
 *
 * Explicit invalidation only; see `useM_ApiKeys_Issue` for why no realtime.
 */
export const useM_Webhooks_Create = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["webhook_endpoints", "create"],
        mutationFn: async (body: UseM_Webhooks_Create_Body) => {
            const sb_RpcWebhookEndpointCreate = await supabase.rpc("webhook_endpoint_create", {
                p_organization_id: body.organizationId,
                p_name: body.name,
                p_url: body.url,
                p_events: body.events,
            });
            if (sb_RpcWebhookEndpointCreate.error) throw sb_RpcWebhookEndpointCreate.error;

            const created = sb_RpcWebhookEndpointCreate.data?.[0];
            if (!created?.signing_secret) {
                throw new Error("The endpoint was not created. Nothing was changed.");
            }
            return created;
        },
        onSuccess: () => {
            // No toast: the reveal panel is the success state, and a toast over
            // the one and only showing of a signing secret is the wrong thing to
            // put on that screen.
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.webhook_endpoints.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to create the endpoint"));
        },
    });

    return { mutation };
};
