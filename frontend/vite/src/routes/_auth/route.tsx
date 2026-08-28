import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/configs/supabase/config";
import { BG_GRADIENT } from "@/providers/antd/Provider_ANTD";
import { theme } from "antd";

export const Route = createFileRoute("/_auth")({
    beforeLoad: async ({ location }) => {
        const sb_Auth_GetSession = await supabase.auth.getSession();
        const session = sb_Auth_GetSession.data.session;

        // Signed-in users belong in the app, not on the auth screens — except on the
        // pages that only make sense with a session. `/pending-access` (CG-027) is
        // load-bearing here: without it a non-whitelisted account bounces between
        // this layout sending it to `/home` and `_protected` sending it back, forever.
        //
        // `/home`, NOT `/`: since CG-052 `/` is the public landing page, so
        // redirecting there would drop a signed-in user who opened `/login` onto
        // marketing copy instead of their dashboard — and would defeat the loop
        // guard above, which only works because this redirect lands inside
        // `_protected`.
        const allowAuthenticated = [
            "/reset-password",
            "/invitation",
            "/verify-email",
            "/pending-access",
        ];
        if (session && !allowAuthenticated.includes(location.pathname)) {
            throw redirect({ to: "/home" });
        }
    },
    component: AuthLayout,
});

function AuthLayout() {
    const { token } = theme.useToken();

    return (
        <div
            style={{
                height: "var(--app-vh)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: token.paddingLG,
                overflow: "auto",
                background: BG_GRADIENT,
            }}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 420,
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    padding: "36px 28px 28px",
                    boxShadow: token.boxShadowSecondary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                }}
            >
                <Outlet />
            </div>
        </div>
    );
}
