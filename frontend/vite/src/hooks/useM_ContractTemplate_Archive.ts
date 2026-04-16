import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_ContractTemplate_Archive = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["contractTemplates", "archive"],
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
