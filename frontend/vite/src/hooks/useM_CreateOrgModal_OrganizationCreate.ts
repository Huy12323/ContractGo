import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export const useM_CreateOrgModal_OrganizationCreate = () => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationFn: async (orgName: string) => {
            const sb_RpcCreateOrganization = await supabase.rpc("create_organization", { org_name: orgName });
            if (sb_RpcCreateOrganization.error) throw sb_RpcCreateOrganization.error;
            return sb_RpcCreateOrganization.data;
        },
        onSuccess: () => {
            message.success("Organization created");
            queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() });
        },
        onError: (err) => {
            message.error(err instanceof Error ? err.message : "Failed to create organization");
        },
    });

    return { mutation };
};
