import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_OrgSettings_OrganizationDelete = ({
    organizationId,
    onSuccess: onSuccessCallback,
}: {
    organizationId: string;
    onSuccess?: () => void;
}) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async () => {
            // Without the `.select()`, RLS denial is indistinguishable from
            // success: only the owner may delete, and the policy filters the row
            // out instead of raising, so a bare `.delete()` returns no error and
            // deletes nothing — and a non-owner was told "Organization deleted".
            const sb_FromOrganizations_Delete = await supabase
                .from("organizations")
                .delete()
                .eq("id", organizationId)
                .select("id");
            if (sb_FromOrganizations_Delete.error) throw sb_FromOrganizations_Delete.error;
            if (!sb_FromOrganizations_Delete.data?.length) {
                throw new Error("You do not have permission to delete this organization");
            }
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
