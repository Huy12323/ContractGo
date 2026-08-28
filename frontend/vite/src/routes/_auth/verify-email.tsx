import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { Page_VerifyEmail } from "@/pages/Page_VerifyEmail/Page_VerifyEmail";

export const Route = createFileRoute("/_auth/verify-email")({
    validateSearch: (search: Record<string, unknown>): { token?: string; redirect?: string } => ({
        token: typeof search.token === "string" ? search.token : undefined,
        redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    }),
    beforeLoad: async ({ search }) => {
        // If there's a token param, let the page handle verification — don't redirect
        if (search.token) return;

        // If user has a session, check if already verified — redirect out if so
        const sb_Auth_GetSession = await supabase.auth.getSession();
        const session = sb_Auth_GetSession.data.session;
        if (session) {
            const sb_FromProfiles_Select = await supabase
                .from("profiles")
                .select("email_verified")
                .eq("id", session.user.id)
                .single();

            if (sb_FromProfiles_Select.data?.email_verified) {
                throw redirect({ to: "/home" });
            }
        }
    },
    component: Page_VerifyEmail,
});
