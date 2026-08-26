import { createFileRoute } from "@tanstack/react-router";
import { Page_Settings } from "@/pages/Page_Settings/Page_Settings";

// A sibling of `_protected/index.tsx` rather than a child of `$organizationId`:
// the account page belongs to a person, not to an organization. It still sits
// under `_protected`, so it inherits the session, email-verified and whitelist
// gates from that layout's `beforeLoad`.
export const Route = createFileRoute("/_protected/settings")({
    component: Page_Settings,
});
