import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

/**
 * HARD delete of a template row.
 *
 * WHY A HARD DELETE HERE, WHEN THE LIBRARY SOFT-DELETES (`is_archived`). Archiving
 * exists so a template that envelopes were built from stays readable forever. That
 * reasoning does not reach an ad-hoc row the sender abandoned before sending
 * anything: nobody has been asked to sign it, no envelope references it, and
 * leaving it archived would accumulate invisible rows nothing can ever surface or
 * clean up.
 *
 * SAFE BY EXISTING SCHEMA DESIGN, not by luck:
 *   - `contract_template_versions.template_id` is ON DELETE CASCADE, so the
 *     version rows go with it.
 *   - `signature_requests.template_id` is ON DELETE SET NULL, and an envelope
 *     carries its own `source_pdf_r2_key`, `source_pdf_sha256` and
 *     `template_snapshot` — so a sent document survives its template's deletion
 *     intact. That is what makes the snapshot worth having.
 *   - `admin_or_owner_can_delete_contract_templates` already permits it.
 *
 * CALL IT ONLY FOR AN UNREFERENCED ROW. Because the FK is SET NULL rather than
 * RESTRICT, deleting a template an envelope points at SUCCEEDS SILENTLY and
 * quietly severs the "what was this made from?" link on a real document. The
 * caller's `!draftId` guard is what prevents that, and it is load-bearing.
 */
export const useM_Template_Delete = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationKey: ["templates", "delete"],
        mutationFn: async ({ templateId }: { templateId: string }) => {
            const sb_FromContractTemplates_Delete = await supabase
                .from("contract_templates")
                .delete()
                .eq("id", templateId);
            if (sb_FromContractTemplates_Delete.error) throw sb_FromContractTemplates_Delete.error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_template_versions.all() });
        },
        onError: (err: Error) => {
            // Deliberately quiet. Every caller is a CLEANUP path running while the
            // user walks away from something — a toast about a discarded draft's
            // bookkeeping would be noise about a decision they already made.
            console.error("Failed to delete ad-hoc template (non-fatal):", err);
        },
    });

    return { mutation };
};
