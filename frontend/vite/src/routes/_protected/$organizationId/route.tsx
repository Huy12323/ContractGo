import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Provider_Organization } from "@/providers/organization/Provider_Organization";

export const Route = createFileRoute("/_protected/$organizationId")({
    beforeLoad: async ({ params }) => {
        const sb_RpcGetMyMemberOrganizations = await supabase.rpc("get_my_member_organizations");
        if (sb_RpcGetMyMemberOrganizations.error) {
            throw redirect({ to: "/" });
        }
        const isMember = sb_RpcGetMyMemberOrganizations.data?.some(
            (org) => org.id === params.organizationId
        );
        if (!isMember) {
            throw redirect({ to: "/" });
        }
    },
    component: OrganizationLayout,
});

function OrganizationLayout() {
    const { organizationId } = Route.useParams();
    return (
        <Provider_Organization key={organizationId} initialState={{ organizationId }}>
            <Outlet />
        </Provider_Organization>
    );
}
