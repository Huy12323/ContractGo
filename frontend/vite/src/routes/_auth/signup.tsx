import { createFileRoute } from "@tanstack/react-router";
import { Page_SignUp } from "@/pages/Page_SignUp/Page_SignUp";

export const Route = createFileRoute("/_auth/signup")({
    validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
        redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    }),
    component: Page_SignUp,
});
