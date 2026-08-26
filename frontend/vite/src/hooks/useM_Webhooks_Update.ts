import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";
import type { Webhook_Event } from "@/hooks/useM_Webhooks_Create";

export type UseM_Webhooks_Update_Body = {
    endpointId: string;
    name?: string;
    url?: string;
    events?: Webhook_Event[];
    isEnabled?: boolean;
};

/**
 * Edits an endpoint, and — when it re-enables one — clears the circuit breaker.
 *
 * THAT SECOND BEHAVIOUR LIVES IN THE RPC, and this hook's copy depends on it.
 * `webhook_endpoint_update` zeroes `consecutive_failures` and nulls
 * `disabled_at` / `disabled_reason` whenever `p_is_enabled` is true (CG-045).
 * Without it, re-enabling would leave the counter sitting at its threshold and
 * the very next failure would switch the endpoint off again — which reads to the
 * admin who just pressed the button as "re-enable did not work".
 *
 * EVERY FIELD IS OPTIONAL AND OMISSION MEANS "LEAVE IT". The RPC's parameters
 * default to NULL and it treats NULL as no-change, so the enable/disable toggle
 * sends only `isEnabled` and cannot accidentally blank a URL. `undefined` is
 * therefore passed through deliberately rather than normalised to null.
 */
export const useM_Webhooks_Update = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["webhook_endpoints", "update"],
        mutationFn: async (body: UseM_Webhooks_Update_Body) => {
            const sb_RpcWebhookEndpointUpdate = await supabase.rpc("webhook_endpoint_update", {
                p_endpoint_id: body.endpointId,
                p_name: body.name,
                p_url: body.url,
                p_events: body.events,
                p_is_enabled: body.isEnabled,
            });
            if (sb_RpcWebhookEndpointUpdate.error) throw sb_RpcWebhookEndpointUpdate.error;

            // ⚠ A REFUSAL RAISES, IT DOES NOT RETURN FALSE. The RPC checks
            // is_admin_or_owner first and raises "unknown endpoint" both for a
            // row that does not exist and for one in another organization —
            // deliberately the same words, so the endpoint cannot be used to
            // probe which endpoints exist. That path lands in onError.
            //
            // This check is therefore a belt-and-braces guard on a shape the
            // RPC does not currently produce, kept because a silent no-op on
            // "disable this endpoint" would leave an admin believing they
            // stopped something they did not.
            if (sb_RpcWebhookEndpointUpdate.data !== true) {
                throw new Error("That endpoint could not be updated.");
            }
            return body;
        },
        onSuccess: (body) => {
            message.success(
                body.isEnabled === true
                    ? "Endpoint enabled. Its failure count has been reset."
                    : body.isEnabled === false
                      ? "Endpoint disabled. No further events will be delivered to it."
                      : "Endpoint updated"
            );
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.webhook_endpoints.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to update the endpoint"));
        },
    });

    return { mutation };
};
