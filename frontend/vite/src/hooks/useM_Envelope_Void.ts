import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";

export type UseM_Envelope_Void_Body = {
    organization_id: string;
    envelope_id: string;
    reason?: string;
};

/**
 * Withdraws a document that is still in flight.
 *
 * "Void", never "delete": the row and its audit chain survive, because a
 * document someone was asked to sign and then was not is a fact about what
 * happened. The edge function revokes every outstanding access token, which is
 * what actually closes the door — the status alone would leave the emailed links
 * able to render the document.
 *
 * Invalidates explicitly AND relies on the realtime channel (hybrid policy): the
 * AHR-2100 realtime trigger on `signature_requests` will also fire, and neither
 * mechanism is stripped because the other exists — realtime can be disconnected,
 * and an invalidation cannot tell a second browser tab anything.
 */
export const useM_Envelope_Void = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "void"],
        mutationFn: async (body: UseM_Envelope_Void_Body) => {
            const sb_FunctionsEnvelopesVoid_Invoke = await supabase.functions.invoke(
                "envelopes_void",
                { body }
            );
            if (sb_FunctionsEnvelopesVoid_Invoke.error) {
                throw await utils_Signing_UnwrapError(sb_FunctionsEnvelopesVoid_Invoke.error);
            }
            return sb_FunctionsEnvelopesVoid_Invoke.data as { id: string; status: "cancelled" };
        },
        onSuccess: (_result, variables) => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_audit_log.all() });
            message.success("Document voided. The signing links no longer work.");
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to void the document");
        },
    });

    return { mutation };
};
