import { useMutation } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type Webhook_TestSend_Result = {
    endpoint_id: string;
    delivered: boolean;
    status_code: number | null;
    latency_ms: number;
    /** Whatever the endpoint wrote back, truncated by the function. Often empty. */
    response_body: string | null;
    error: string | null;
    signature_header: string;
    signed_payload_preview: string;
};

/**
 * Sends one synthetic event to an endpoint and reports exactly what happened.
 *
 * ⚠ A FAILED TEST IS A SUCCESSFUL CALL. The edge function returns 200 whatever
 * the endpoint answered, so this mutation RESOLVES when the endpoint returns
 * 500 — `delivered: false` is the result, not an error (CG-046, and the same
 * distinction v1.3.0 drew for `verify_document`'s `verified: false`). Rejecting
 * here would render a system fault over a diagnostic that worked perfectly and
 * reported bad news, and the caller would show "something went wrong" instead of
 * "your server returned 500", which is the one thing they needed to know.
 *
 * It echoes `signature_header` and `signed_payload_preview` so an integrator
 * whose verification is failing can compare our bytes against theirs. THE SECRET
 * IS NEVER ECHOED — the header is a MAC over the payload, which reveals nothing,
 * and the preview is the exact string that was signed.
 *
 * NO CACHE INVALIDATION, deliberately. A test send writes no delivery row and no
 * audit entry: it is a diagnostic, not an event. Invalidating the endpoints list
 * would suggest the health figures had changed when they have not.
 *
 * A DISABLED ENDPOINT IS STILL TESTABLE, by design — the whole point of pressing
 * this is to find out whether it is safe to switch back on.
 */
export const useM_Webhooks_TestSend = () => {
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["webhook_endpoints", "test_send"],
        mutationFn: async (body: { organization_id: string; endpoint_id: string }) => {
            const sb_FunctionsWebhooksTestSend_Invoke = await supabase.functions.invoke(
                "webhooks_test-send",
                { body }
            );
            if (sb_FunctionsWebhooksTestSend_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsWebhooksTestSend_Invoke.error);
            }
            return sb_FunctionsWebhooksTestSend_Invoke.data as Webhook_TestSend_Result;
        },
        onError: (err: Error) => {
            // Reached only when the call to US failed — a signed-out session, an
            // endpoint that is not ours, our own outage. What the endpoint said
            // never comes through here.
            console.error(err);
            message.error(err.message || "Could not send the test event");
        },
    });

    return { mutation };
};
