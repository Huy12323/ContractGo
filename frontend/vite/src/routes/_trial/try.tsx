import { createFileRoute } from "@tanstack/react-router";
import { Page_Trial } from "@/pages/Page_Trial/Page_Trial";

export const Route = createFileRoute("/_trial/try")({
    component: Page_Trial,
});
