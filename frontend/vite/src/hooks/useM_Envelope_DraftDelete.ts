import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * Deletes a draft.
 *
 * THE ONLY ENVELOPE WRITE IN THE PROJECT THAT GOES STRAIGHT THROUGH POSTGREST,
 * and it is safe for a reason that is worth stating rather than assuming. Every
 * other envelope mutation is an edge function because it needs service_role — to
 * mint tokens, to read storage, to append to the hash chain. This one needs none
 * of that, and the guard it needs already exists in the database:
 *
 *     CREATE POLICY "admin_or_owner_can_delete_signature_requests"
 *         ON signature_requests FOR DELETE TO authenticated
 *         USING (is_admin_or_owner(organization_id) AND status = 'draft');
 *
 * CG-005 wrote that policy with exactly this in mind. `status = 'draft'` is in the
 * USING clause, so a sent, completed, declined or expired envelope is not
 * deletable by anyone at any privilege level through any client — the row and its
 * audit chain stay, and `envelopes_void` is what closes a live one. Wrapping this
 * in an edge function would move the check OUT of the database (service_role
 * bypasses RLS) and into TypeScript, which is strictly worse.
 *
 * A draft that has quietly been sent from another tab therefore deletes NOTHING
 * rather than erroring, because PostgREST reports success for a DELETE that
 * matched no rows — the same fact `signing_decline` and `envelopes_cron_expire`
 * are built around. `count: "exact"` is what turns that silence into an answer, so
 * the sender is told the draft went out rather than being shown it disappear.
 *
 * The signer rows go with it: `signature_request_signers.request_id` is
 * `ON DELETE CASCADE`.
 */
export const useM_Envelope_DraftDelete = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["envelopes", "draft-delete"],
        mutationFn: async ({ envelopeId }: { envelopeId: string }) => {
            const sb_FromSignatureRequests_Delete = await supabase
                .from("signature_requests")
                .delete({ count: "exact" })
                .eq("id", envelopeId);

            if (sb_FromSignatureRequests_Delete.error) throw sb_FromSignatureRequests_Delete.error;
            if (!sb_FromSignatureRequests_Delete.count) {
                throw new Error(
                    "This draft could not be deleted — it may already have been sent. Reload to see where it got to."
                );
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.signature_requests.all() });
            queryClient.invalidateQueries({
                queryKey: QueryKeys.signature_request_signers.all(),
            });
            message.success("Draft deleted");
        },
        onError: (err: Error) => {
            console.error(err);
            message.error(err.message || "Failed to delete the draft");
        },
    });

    return { mutation };
};
