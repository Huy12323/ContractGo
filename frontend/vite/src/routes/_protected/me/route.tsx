import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Provider_Organization } from "@/providers/organization/Provider_Organization";

// CG-048 — THE PERSONAL WORKSPACE.
//
// A REAL LAYOUT ROUTE with an `<Outlet/>`, not a component wrapping the pages.
// Wrapping would remount the frame on every navigation between its children and
// lose the provider state with it, which is why every layout in this tree is a
// route — see the same note in `_protected/route.tsx` and
// `_protected/$organizationId/route.tsx`.
//
// The sibling of `$organizationId`, deliberately. Below this line everything is
// identical to an organization: the same provider carries the same
// `organizationId`, the same queries authorize on it, the same edge functions
// serve it. The ONLY difference is `scope`, which decides where links point.
//
// WHY THERE IS NO MEMBERSHIP GUARD HERE. `$organizationId` has one because its
// id comes from the URL and therefore from the user. This route's id comes from
// the RPC, which derives it from `auth.uid()` and can only ever return the
// caller's own workspace — there is no id to tamper with. `_protected/route.tsx`
// above has already established the session, the verified email and the
// whitelist.
export const Route = createFileRoute("/_protected/me")({
    beforeLoad: async () => {
        // Provisioning is lazy, and this is where it happens: first visit creates the
        // workspace and its default entity, every visit after returns the same id.
        // The RPC is idempotent and race-safe (CG-048 PHASE 2), so calling it on
        // every navigation into the branch is correct, not merely tolerable.
        const sb_RpcEnsurePersonalOrganization = await supabase.rpc("ensure_personal_organization");
        if (sb_RpcEnsurePersonalOrganization.error || !sb_RpcEnsurePersonalOrganization.data) {
            // Fails closed to the home page rather than rendering a workspace with an
            // empty id, which would send `organization_id: ''` to every query below.
            throw redirect({ to: "/home" });
        }
        return { personalOrganizationId: sb_RpcEnsurePersonalOrganization.data };
    },
    component: PersonalLayout,
});

function PersonalLayout() {
    const { personalOrganizationId } = Route.useRouteContext();
    return (
        <Provider_Organization
            key={personalOrganizationId}
            initialState={{ organizationId: personalOrganizationId, scope: "personal" }}
        >
            <Outlet />
        </Provider_Organization>
    );
}
