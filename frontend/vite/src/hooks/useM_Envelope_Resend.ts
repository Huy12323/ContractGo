import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Envelope_Resend_Body = {
    organization_id: string;
    envelope_id: string;
};

export type UseM_Envelope_Resend_Result = {
    id: string;
    status: "sent" | "partially_sent";
    notified: string[];
    failed?: string[];
};

/**
 * Emails the signing link again to whoever the document is waiting on.
 *
 * A resend mints a NEW token and revokes the previous one, so the older link
 * stops working — worth saying in the UI, because a recipient who kept the first
 * email would otherwise report a dead link as a bug.
 */
export const useM_Envelope_Resend = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "resend"],
        mutationFn: async (body: UseM_Envelope_Resend_Body) => {
            const sb_FunctionsEnvelopesResend_Invoke = await supabase.functions.invoke(
                "envelopes_resend",
                { body }
            );
            if (sb_FunctionsEnvelopesResend_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsEnvelopesResend_Invoke.error);
            }
            return sb_FunctionsEnvelopesResend_Invoke.data as UseM_Envelope_Resend_Result;
        },
        onSuccess: (result, variables) => {
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });

            if (result.status === "partially_sent") {
                message.warning(
                    `Could not reach ${(result.failed ?? []).join(", ")}. Check the address and try again.`
                );
                return;
            }
            message.success(
                `A new link was sent to ${result.notified.join(", ")}. The previous link no longer works.`
            );
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to resend");
        },
    });

    return { mutation };
};
