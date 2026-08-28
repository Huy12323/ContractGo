import { Link, useMatch } from "@tanstack/react-router";
import { Layout, Button, Typography, theme } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { App_UserMenu } from "@/components/app-shell/App_UserMenu";
import { App_NotificationBell } from "@/components/notifications/App_NotificationBell";
import { Store_VerticalNav_Actions } from "@/stores/Store_VerticalNav";
import { const_AppShell_HorizontalNavHeight } from "@/components/app-shell/const_AppShell_Dimensions";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

const { Header } = Layout;

export const App_HorizontalNav = () => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    const isOrgRoute =
        useMatch({
            from: "/_protected/$organizationId",
            shouldThrow: false,
            select: () => true,
        }) ?? false;

    return (
        <Header
            style={{
                background: token.colorFillQuaternary,
                // Safe-area aware because `index.html` sets `viewport-fit=cover`: in
                // landscape on a notched phone the left inset is where the notch is, and
                // without this the hamburger sits under it. No `--app-safe-top` — inside a
                // browser tab that inset is zero and the padding would just be dead space.
                paddingBlock: 0,
                paddingLeft: `calc(${token.paddingMD}px + var(--app-safe-left))`,
                paddingRight: `calc(${token.paddingMD}px + var(--app-safe-right))`,
                height: const_AppShell_HorizontalNavHeight,
                lineHeight: `${const_AppShell_HorizontalNavHeight}px`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "sticky",
                top: 0,
                zIndex: 100,
            }}
        >
            <div
                style={{ display: "flex", alignItems: "center", gap: token.marginXS, minWidth: 0 }}
            >
                {isOrgRoute && (
                    // One control, two behaviours, because the nav itself is two things:
                    // a sider that collapses to icons on desktop, a drawer that opens over
                    // the page on mobile. Dispatching here keeps that knowledge in the
                    // component that renders the button rather than in the store.
                    <Button
                        type="text"
                        aria-label="Toggle navigation"
                        icon={<MenuOutlined />}
                        onClick={
                            isMobile
                                ? Store_VerticalNav_Actions.toggleMobile
                                : Store_VerticalNav_Actions.toggle
                        }
                        style={{ fontSize: token.fontSizeLG, color: token.colorText }}
                    />
                )}
                <Link
                    to="/home"
                    style={{ display: "flex", alignItems: "center", textDecoration: "none" }}
                >
                    <Typography.Text
                        style={{
                            fontWeight: 900,
                            fontSize: token.fontSizeLG,
                            color: token.colorText,
                        }}
                    >
                        ContractGo
                    </Typography.Text>
                </Link>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginSM,
                    flexShrink: 0,
                }}
            >
                <App_NotificationBell />
                <App_UserMenu />
            </div>
        </Header>
    );
};
