import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Page_PendingAccess } from "@/pages/Page_PendingAccess/Page_PendingAccess";

// CG-027. The other side of the `_protected` whitelist gate: this is where a
// signed-in but unapproved account lands. It sits under `_auth` because that is
// where every "you have a session but cannot use the app yet" screen lives —
// /verify-email is the same shape — and because the layout's `allowAuthenticated`
// list is what stops it bouncing the user straight back to `/`.
export const Route = createFileRoute("/_auth/pending-access")({
    beforeLoad: async () => {
        const sb_Auth_GetSession = await supabase.auth.getSession();
        if (!sb_Auth_GetSession.data.session) {
            // No `redirect` back to here: a signed-out visitor has nothing to return
            // to, and the whitelist gate will route them again after they sign in.
            throw redirect({ to: "/login", search: { redirect: undefined } });
        }

        // Approved since the last visit — including the common case of the operator
        // adding the address while this tab sat open. Don't show a blocked screen to
        // somebody who is no longer blocked.
        // CG-035: read off the profile row rather than the old `is_whitelisted()` RPC.
        // Same question, same answer, one fewer bespoke surface.
        const sb_FromProfiles_Select = await supabase
            .from("profiles")
            .select("whitelist")
            .eq("id", sb_Auth_GetSession.data.session.user.id)
            .single();

        if (sb_FromProfiles_Select.data?.whitelist) {
            throw redirect({ to: "/home" });
        }
    },
    component: Page_PendingAccess,
});
