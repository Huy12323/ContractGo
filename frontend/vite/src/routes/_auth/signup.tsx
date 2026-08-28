import { createFileRoute } from "@tanstack/react-router";
import { Page_SignUp } from "@/pages/Page_SignUp/Page_SignUp";

export const Route = createFileRoute("/_auth/signup")({
    validateSearch: (search: Record<string, unknown>): { redirect?: string; from?: string } => ({
        redirect: typeof search.redirect === "string" ? search.redirect : undefined,
        // Where the signup came from, for attribution. Declared here because
        // `validateSearch` STRIPS anything it does not name — a link carrying
        // `?from=trial` without this loses it silently rather than failing.
        //
        // It is needed at all because `Referrer-Policy: no-referrer` is global
        // (see `public/_headers`, where it protects the bearer credential in a
        // signing URL's path), so a visitor arriving from `/try` carries no
        // referrer and there is nothing else to attribute them by.
        from: typeof search.from === "string" ? search.from : undefined,
    }),
    component: Page_SignUp,
});
