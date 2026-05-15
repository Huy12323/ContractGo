import { createFileRoute } from "@tanstack/react-router";
import { PageApps_Tasks } from "@/pages/Page_Apps/PageApps_Tasks";

export const Route = createFileRoute("/_protected/$organizationId/apps/tasks")({
    component: PageApps_Tasks,
});
