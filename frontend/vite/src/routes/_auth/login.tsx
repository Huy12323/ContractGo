import { createFileRoute } from "@tanstack/react-router";
import { Page_Login } from "@/pages/Page_Login/Page_Login";

export const Route = createFileRoute("/_auth/login")({
    // Explicit optional-property return type: without it both keys infer as
    // `string | undefined` *required*, and every existing `navigate({ to: '/login',
    // search: { redirect } })` call site would have to start spelling out
    // `error: undefined` just to typecheck.
    validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => ({
        redirect: typeof search.redirect === "string" ? search.redirect : undefined,
        // Set by /auth/callback when the OAuth round trip came back without a
        // session, so the login screen can say what happened instead of looking
        // like the button did nothing.
        error: typeof search.error === "string" ? search.error : undefined,
    }),
    component: Page_Login,
});
