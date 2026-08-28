import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Page_Landing } from "@/pages/Page_Landing/Page_Landing";

export const Route = createFileRoute("/_marketing/")({
    // A signed-in visitor who opens the root URL wants their dashboard, not the
    // pitch for a product they already bought.
    //
    // ON THIS ROUTE, NEVER ON THE `_marketing` LAYOUT. A layout `beforeLoad`
    // runs for every child, so putting it one level up would make the whole
    // marketing branch unreachable while signed in — and the trial at `/try`
    // sits under `_trial` precisely so it stays open to everyone, including
    // someone with an account who wants to see what their counterparties will
    // experience. Scoped here, `/` redirects and nothing else changes.
    //
    // THE COST, stated because it is real: this puts an auth call on the
    // critical path of the site's highest-traffic ANONYMOUS url, so visitors
    // with no session pay a round trip to `getSession()` before the landing page
    // paints. It resolves from local storage rather than the network in the
    // common case, which is what makes that acceptable — but it is the reason
    // this guard must stay on this one route and not spread.
    beforeLoad: async () => {
        const sb_Auth_GetSession = await supabase.auth.getSession();
        if (sb_Auth_GetSession.data.session) throw redirect({ to: "/home" });
    },
    component: Page_Landing,
});
