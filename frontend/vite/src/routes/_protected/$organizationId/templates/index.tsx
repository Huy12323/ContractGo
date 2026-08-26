import { createFileRoute } from "@tanstack/react-router";
import { Page_Templates } from "@/pages/Page_Templates/Page_Templates";

export const Route = createFileRoute("/_protected/$organizationId/templates/")({
    component: Page_Templates,
});
