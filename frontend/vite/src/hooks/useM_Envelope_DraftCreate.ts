import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";
import { utils_Signing_UnwrapError } from "@/hooks/useQ_Signing_Session";
import type { UseM_Envelope_Send_Body } from "@/hooks/useM_Envelope_Send";

/**
 * The draft body is the send body minus the promises it cannot keep.
 *
 * Structurally the same payload, deliberately — the composer holds one
 * composition and should not have to shape it twice — but the server validates it
 * far more loosely (`validateForDraft` vs `validateForSend`). Recipients may be
 * half-typed, roles may be uncovered, the sender's own required fields may be
 * empty. All of that is a reason a SEND must fail and none of it is a reason a
 * SAVE should.
 */
export type UseM_Envelope_DraftCreate_Body = Omit<UseM_Envelope_Send_Body, "title"> & {
    /** Falls back to the template's name server-side rather than being refused. */
    title?: string;
};

export type UseM_Envelope_DraftCreate_Result = {
    id: string;
    status: "draft";
    title: string;
    recipient_count: number;
    first_order: number;
};

/**
 * Saves a half-composed envelope so it can be finished later.
 *
 * There is no client-side insert here and there cannot be, which is why this is
 * an edge function like every other envelope write:
 * `signature_requests.source_pdf_sha256` is NOT NULL and it is evidence, so the
 * row cannot exist until a server has read the template's PDF and hashed it. That
 * constraint is what deferred drafts out of v1.0 altogether — see
 * `envelopes_draft_create`'s header.
 *
 * Returns the new envelope's id, which the composer keeps so that every
 * subsequent save is an UPDATE. Without that, a sender pressing save twice would
 * end up with two drafts of the same document.
 *
 * `ext-tanstack-query-mutation` chooses HYBRID invalidation, so the local
 * invalidation stays even though these tables carry realtime triggers.
 */
export const useM_Envelope_DraftCreate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "draft-create"],
        mutationFn: async (body: UseM_Envelope_DraftCreate_Body) => {
            const sb_FunctionsEnvelopesDraftCreate_Invoke = await supabase.functions.invoke(
                "envelopes_draft_create",
                { body }
            );
            if (sb_FunctionsEnvelopesDraftCreate_Invoke.error) {
                throw await utils_Signing_UnwrapError(
                    sb_FunctionsEnvelopesDraftCreate_Invoke.error
                );
            }
            return sb_FunctionsEnvelopesDraftCreate_Invoke.data as UseM_Envelope_DraftCreate_Result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_request_signers.all(),
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
