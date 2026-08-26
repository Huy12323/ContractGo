import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";

/**
 * Removes an endpoint and every delivery record it owns.
 *
 * A REAL DELETE, unlike `api_key_revoke`, and the asymmetry is deliberate. A
 * revoked API key stays because the audit chain NAMES it — entries record
 * `api_key_id` and `api_key_name`, and deleting the row would leave those
 * entries pointing at nothing. Webhook deliveries are operational, not
 * evidentiary: nothing in `signature_audit_log` references an endpoint, so
 * removing one destroys no part of the record of what happened to a document.
 *
 * The confirm that calls this must name what stops, because nothing else will:
 * deleting an endpoint is silent at the receiving end. Their server simply never
 * hears from us again.
 */
export const useM_Webhooks_Delete = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["webhook_endpoints", "delete"],
        mutationFn: async (endpointId: string) => {
            const sb_RpcWebhookEndpointDelete = await supabase.rpc("webhook_endpoint_delete", {
                p_endpoint_id: endpointId,
            });
            if (sb_RpcWebhookEndpointDelete.error) throw sb_RpcWebhookEndpointDelete.error;
            if (sb_RpcWebhookEndpointDelete.data !== true) {
                throw new Error("That endpoint could not be deleted.");
            }
        },
        onSuccess: () => {
            message.success("Endpoint deleted. It will receive no further events.");
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.webhook_endpoints.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to delete the endpoint"));
        },
    });

    return { mutation };
};
