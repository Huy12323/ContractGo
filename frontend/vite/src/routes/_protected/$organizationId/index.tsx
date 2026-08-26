import { createFileRoute } from "@tanstack/react-router";
import { Page_Dashboard } from "@/pages/Page_Dashboard/Page_Dashboard";

export const Route = createFileRoute("/_protected/$organizationId/")({
    component: Page_Dashboard,
});
