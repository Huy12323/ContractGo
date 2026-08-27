import { createFileRoute } from "@tanstack/react-router";
import { Page_OrgSettingsDocuments } from "@/pages/Page_OrgSettingsDocuments/Page_OrgSettingsDocuments";

// The parent `settings` layout establishes admin-or-owner and renders an
// explanation instead of an `<Outlet/>` for anyone else, so this never mounts
// for a member. Ownership is checked inside the page, not here — see the layout.
export const Route = createFileRoute("/_protected/$organizationId/settings/documents")({
    component: Page_OrgSettingsDocuments,
});
