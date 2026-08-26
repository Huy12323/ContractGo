import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { Utils_Rpc_FriendlyError } from "@/utils/Utils_Rpc_FriendlyError";

/**
 * Replaces an endpoint's signing secret and returns the new one exactly once.
 *
 * ⚠ THERE IS NO OVERLAP WINDOW, AND THAT IS THE DESIGN (CG-045). A grace period
 * during which both the old and the new secret verify would mean a consumer that
 * accepts either — which is precisely the state a rotation exists to LEAVE. So
 * rotating breaks delivery until the consumer is updated, which is the intended
 * behaviour of a rotation performed because the old secret is compromised.
 *
 * The UI that calls this has to say that plainly before it happens. An admin who
 * rotates expecting a seamless handover has just taken their own integration
 * down and does not know it yet.
 *
 * ⚠ The RPC returns the secret as a scalar. It still WRITES, so the CG-043 rule
 * applies to any future rewrite of it into a row-returning shape: never
 * `.single()` on an RPC with a side effect.
 */
export const useM_Webhooks_RotateSecret = ({ organizationId }: { organizationId: string }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["webhook_endpoints", "rotate_secret"],
        mutationFn: async (endpointId: string) => {
            const sb_RpcWebhookEndpointRotateSecret = await supabase.rpc(
                "webhook_endpoint_rotate_secret",
                { p_endpoint_id: endpointId }
            );
            if (sb_RpcWebhookEndpointRotateSecret.error) {
                throw sb_RpcWebhookEndpointRotateSecret.error;
            }

            const secret = sb_RpcWebhookEndpointRotateSecret.data;
            if (!secret) {
                throw new Error("The secret was not rotated. Nothing was changed.");
            }
            return secret;
        },
        onSuccess: () => {
            // No toast — the reveal panel is the success state, and it carries
            // the warning that deliveries are now failing until the consumer is
            // updated. A cheerful "Secret rotated" over that would be worse than
            // saying nothing.
            queryClient.invalidateQueries({
                queryKey: [...QueryKeys.webhook_endpoints.list(), organizationId],
            });
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(Utils_Rpc_FriendlyError(err, "Failed to rotate the signing secret"));
        },
    });

    return { mutation };
};
