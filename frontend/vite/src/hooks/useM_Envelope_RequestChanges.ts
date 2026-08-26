import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Envelope_RequestChanges_Body = {
    organization_id: string;
    envelope_id: string;
    signer_id: string;
    /** Required by the server — see the hook's note. */
    reason: string;
};

export type UseM_Envelope_RequestChanges_Result = {
    id: string;
    signer_id: string;
    status: "changes_requested";
    rewound_to: number | null;
    notified: boolean;
    notified_email?: string;
    message?: string;
};

/**
 * Sends one signer's turn back so they can sign again.
 *
 * The only action in the envelope surface that moves the routing BACKWARDS, and
 * the only one that reopens a completed signature. `envelopes_request-changes`
 * carries the reasoning; what matters at this layer is that the success message
 * says three things the sender cannot see from the list on their own:
 *
 *   * the earlier signature is superseded, not deleted — it stays on the audit
 *     trail, which is what makes this safe to do rather than destructive;
 *   * a NEW link was emailed, so any earlier one is dead. This is a resend as
 *     well as a rewind, and a sender who does not know that will not understand
 *     why the signer's old link stopped working;
 *   * the document now waits on that signer again, so parties further along are
 *     back to waiting.
 *
 * The 207 branch is not an error and must not be reported as one: the turn WAS
 * sent back and retrying would answer "they have not signed yet", which reads as
 * "nothing happened" about something that did. It is a delivery to retry with
 * Resend link.
 *
 * `ext-tanstack-query-mutation` chooses HYBRID invalidation, so the local
 * invalidation stays even though `signature_request_signers` carries a realtime
 * trigger: realtime is additive to it, never a replacement.
 */
export const useM_Envelope_RequestChanges = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "request-changes"],
        mutationFn: async (body: UseM_Envelope_RequestChanges_Body) => {
            const sb_FunctionsEnvelopesRequestChanges_Invoke = await supabase.functions.invoke(
                "envelopes_request-changes",
                { body }
            );
            if (sb_FunctionsEnvelopesRequestChanges_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesRequestChanges_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesRequestChanges_Invoke.data as UseM_Envelope_RequestChanges_Result;
        },
        onSuccess: (result, variables) => {
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });

            if (!result.notified) {
                message.warning(
                    result.message ??
                        "The turn was sent back, but the email did not go out. Use Resend link to give them a working link."
                );
                return;
            }
            message.success(
                `${result.notified_email} has been emailed a new link and asked to sign again. Their earlier signature is kept on the audit trail but no longer counts.`
            );
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to send this turn back");
        },
    });

    return { mutation };
};
