import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { supabase } from "@/configs/supabase/config";
import { QueryKeys } from "@/utils/query/queryKeys";

export type UseM_OrgSettings_OrganizationUpdate_Params = { organizationId: string };
export type UseM_OrgSettings_OrganizationUpdate_Body = Partial<{
    name: string;
}>;

export const useM_OrgSettings_OrganizationUpdate = ({
    organizationId,
}: UseM_OrgSettings_OrganizationUpdate_Params) => {
    const queryClient = useQueryClient();
    const { message } = App.useApp();

    const mutation = useMutation({
        mutationKey: ["organizations", "update", organizationId],
        mutationFn: async (body: UseM_OrgSettings_OrganizationUpdate_Body) => {
            // `.select().single()` is load-bearing, not decoration. Only the owner
            // may update, and RLS enforces that by filtering the row out rather
            // than raising — a bare `.update()` would come back successful having
            // changed nothing. Asking for the row back turns that into an error.
            const sb_FromOrganizations_Update = await supabase
                .from("organizations")
                .update(body)
                .eq("id", organizationId)
                .select()
                .single();
            if (sb_FromOrganizations_Update.error) throw sb_FromOrganizations_Update.error;
            return sb_FromOrganizations_Update.data;
        },
        onSuccess: () => {
            message.success("Organization updated");
            // `.all()` rather than `.record()`: the name is also rendered from the
            // `[...list(), "mine"]` cache by the switcher and Page_Home.
            queryClient.invalidateQueries({ queryKey: QueryKeys.organizations.all() });
        },
        onError: (err) => {
            console.error(err);
            message.error("Failed to update organization");
        },
    });

    return { mutation };
};
