import { createFileRoute } from "@tanstack/react-router";
import { Page_SettingsApiKeys } from "@/pages/Page_SettingsApiKeys/Page_SettingsApiKeys";

// No guard here. The parent `settings` layout establishes admin-or-owner and
// renders an explanation instead of an `<Outlet/>` for anyone else, so this
// component never mounts for a member. The RPCs behind it check again anyway.
export const Route = createFileRoute("/_protected/$organizationId/settings/api-keys")({
    component: Page_SettingsApiKeys,
});
