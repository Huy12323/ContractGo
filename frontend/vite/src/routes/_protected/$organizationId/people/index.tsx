import { createFileRoute } from "@tanstack/react-router";
import { Page_People } from "@/pages/Page_People/Page_People";

// No extra guard. The parent `$organizationId` route already establishes
// membership, and a member IS allowed to see who else is in the organization —
// what they cannot do is invite, which the page gates on `useQ_Tables_MyRole`
// and RLS enforces regardless of what the UI renders.
export const Route = createFileRoute("/_protected/$organizationId/people/")({
    component: Page_People,
});
