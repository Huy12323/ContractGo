import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Envelope_Remind_Body = {
    organization_id: string;
    envelope_id: string;
};

export type UseM_Envelope_Remind_Result = {
    id: string;
    status: "reminded" | "partially_reminded";
    reminded: string[];
    failed?: string[];
};

/**
 * Nudges whoever the document is waiting on, WITHOUT touching their link.
 *
 * The sibling of `useM_Envelope_Resend`, and the pair must stay
 * distinguishable in the UI — see `envelopes_remind`'s header. The success
 * message says the existing link still works, because that is the one fact a
 * sender needs in order to pick between the two buttons: reminding is safe to do
 * repeatedly, resending invalidates whatever the recipient already has.
 *
 * `ext-tanstack-query-mutation` chooses HYBRID invalidation, so the local
 * invalidation below stays even though `signature_request_signers` carries a
 * realtime trigger: realtime is additive to it, never a replacement.
 */
export const useM_Envelope_Remind = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "remind"],
        mutationFn: async (body: UseM_Envelope_Remind_Body) => {
            const sb_FunctionsEnvelopesRemind_Invoke = await supabase.functions.invoke(
                "envelopes_remind",
                { body }
            );
            if (sb_FunctionsEnvelopesRemind_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsEnvelopesRemind_Invoke.error);
            }
            return sb_FunctionsEnvelopesRemind_Invoke.data as UseM_Envelope_Remind_Result;
        },
        onSuccess: (result, variables) => {
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });

            if (result.status === "partially_reminded") {
                message.warning(
                    `Could not reach ${(result.failed ?? []).join(", ")}. Check the address and try again.`
                );
                return;
            }
            message.success(
                `Reminded ${result.reminded.join(", ")}. Their existing signing link still works.`
            );
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to send the reminder");
        },
    });

    return { mutation };
};
