import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_OrgSettings_OrganizationDelete = ({ organizationId, onSuccess: onSuccessCallback }: { organizationId: string; onSuccess?: () => void }) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async () => {
            const sb_FromOrganizations_Delete = await supabase
                .from("organizations")
                .delete()
                .eq("id", organizationId);
            if (sb_FromOrganizations_Delete.error) throw sb_FromOrganizations_Delete.error;
        },
        onSuccess: () => {
            message.success("Organization deleted");
            queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() });
            onSuccessCallback?.();
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to delete organization");
        },
    });

    return { mutation };
};
