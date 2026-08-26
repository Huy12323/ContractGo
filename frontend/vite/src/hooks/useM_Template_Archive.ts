import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

// Renamed from `useM_ContractTemplate_Archive` in Phase F.
//
// Archive, never delete: a sent document pins the template version it was made
// from, and hard-deleting the template must not be the routine way to tidy a
// list. (The snapshot survives a hard delete too — that invariant is what makes
// archiving a UI concern rather than a data-integrity one.)

export const useM_Template_Archive = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["templates", "archive"],
        mutationFn: async ({ templateId }: { templateId: string }) => {
            const sb_FromContractTemplates_Update = await supabase
                .from("contract_templates")
                .update({ is_archived: true })
                .eq("id", templateId);
            if (sb_FromContractTemplates_Update.error) throw sb_FromContractTemplates_Update.error;
        },
        onSuccess: () => {
            message.success("Template archived");
            queryClient.invalidateQueries({ queryKey: QueryKeys.contract_templates.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to archive template");
        },
    });

    return { mutation };
};
