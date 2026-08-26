import { createFileRoute } from "@tanstack/react-router";
import { Page_TemplateBuilder } from "@/pages/Page_TemplateBuilder/Page_TemplateBuilder";

export const Route = createFileRoute("/_protected/$organizationId/templates/$templateId")({
    component: Page_TemplateBuilder,
});
