import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Layout, theme } from "antd";
import { App_VerticalNav } from "@/components/app-shell/App_VerticalNav";
import { App_HorizontalNav } from "@/components/app-shell/App_HorizontalNav";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { supabase } from "@/configs/supabase/config";
import { BG_GRADIENT } from "@/providers/antd/Provider_ANTD";

const { Content } = Layout;

export const Route = createFileRoute("/_protected")({
    beforeLoad: async ({ location }) => {
        const sb_Auth_GetSession = await supabase.auth.getSession();
        const session = sb_Auth_GetSession.data.session;

        if (!session) {
            throw redirect({ to: "/login", search: { redirect: location.href } });
        }

        // One round trip for both checks. CG-035 materialized the whitelist verdict
        // onto the profile row, so what used to be a parallel `is_whitelisted()` RPC
        // beside this SELECT is now a second column on it — this guard runs on every
        // navigation into the app, so the saved request is felt.
        const sb_FromProfiles_Select = await supabase
            .from("profiles")
            .select("email_verified, whitelist")
            .eq("id", session.user.id)
            .single();

        // Check email verification
        if (sb_FromProfiles_Select.data && !sb_FromProfiles_Select.data.email_verified) {
            throw redirect({ to: "/verify-email", search: { redirect: location.href } });
        }

        // Account whitelist (CG-027). Ordered after verification on purpose: a brand
        // new signup should be told to check their inbox, not that they are awaiting
        // approval — they will hit this gate on the way back, once verified.
        //
        // Fails closed. `data` is null when the SELECT errored or the profile row is
        // missing, and `whitelist` is false when the address matches no roster entry;
        // neither is a reason to let the session through. Note this covers the whole
        // app including `/` — there is no authenticated surface below `_protected`
        // that a blocked account can reach.
        if (!sb_FromProfiles_Select.data?.whitelist) {
            throw redirect({ to: "/pending-access" });
        }
    },
    component: ProtectedLayout,
});

function ProtectedLayout() {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        <Layout style={{ height: "var(--app-vh)", background: BG_GRADIENT }}>
            <App_HorizontalNav />

            {/* The inset frame — gutter, rounded corners, border — is decoration that
          costs ~16px of horizontal space. On a 390px screen that is 4% of the
          content width spent on a border, so mobile gets the content edge-to-edge. */}
            <div
                style={{
                    flex: 1,
                    padding: isMobile ? 0 : `0 ${token.paddingXS}px ${token.paddingXS}px`,
                    background: BG_GRADIENT,
                    overflow: "hidden",
                }}
            >
                <Layout
                    style={{
                        height: "100%",
                        borderRadius: isMobile ? 0 : token.borderRadius,
                        border: isMobile ? "none" : `1px solid ${token.colorBorder}`,
                        overflow: "hidden",
                    }}
                >
                    <App_VerticalNav />

                    <Content style={{ overflowY: "auto", overflowX: "hidden" }}>
                        <Outlet />
                    </Content>
                </Layout>
            </div>
        </Layout>
    );
}
