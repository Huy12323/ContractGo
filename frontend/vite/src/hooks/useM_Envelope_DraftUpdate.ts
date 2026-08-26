import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import type { UseM_Envelope_DraftCreate_Body } from "@/hooks/useM_Envelope_DraftCreate";

export type UseM_Envelope_DraftUpdate_Body = UseM_Envelope_DraftCreate_Body & {
    envelope_id: string;
};

export type UseM_Envelope_DraftUpdate_Result = {
    id: string;
    status: "draft";
    title: string;
    recipient_count: number;
    /** May have MOVED since the last save — the server re-resolves the latest
     *  version every time, so a colleague saving the builder is visible here. */
    template_version_number: number;
};

/**
 * Re-saves a draft, replacing its content wholesale.
 *
 * The composer holds the entire composition in local state, so there is nothing
 * partial to send and no need for a patch protocol — which would also have to
 * invent a way to say "remove this recipient" that is distinguishable from "I did
 * not mention them".
 *
 * The 409 branch matters more than it looks: it fires when the draft was SENT or
 * deleted in another tab while this one was still editing. The server refuses
 * rather than rewriting a document whose recipients already hold links to it, and
 * the message says to reload rather than offering a retry that would fail the same
 * way — see `envelopes_draft_update`'s header.
 */
export const useM_Envelope_DraftUpdate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "draft-update"],
        mutationFn: async (body: UseM_Envelope_DraftUpdate_Body) => {
            const sb_FunctionsEnvelopesDraftUpdate_Invoke = await supabase.functions.invoke(
                "envelopes_draft_update",
                { body }
            );
            if (sb_FunctionsEnvelopesDraftUpdate_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDraftUpdate_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDraftUpdate_Invoke.data as UseM_Envelope_DraftUpdate_Result;
        },
        onSuccess: (_result, variables) => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_request_signers.all(),
            });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_requests.record(variables.envelope_id),
            });
            message.success("Draft saved");
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to save the draft");
        },
    });

    return { mutation };
};
