// The landing page's top bar (CG-052).
//
// SESSION-AWARE, AND BEHIND A REDIRECT. `_marketing/index.tsx` sends a
// signed-in visitor from `/` to `/home` in `beforeLoad`, so on the landing page
// the `Go to dashboard` branch below is normally never seen.
//
// It is kept rather than deleted, for two reasons that are not "just in case":
//
//   * the redirect is scoped to `/` alone — deliberately, so `/try` stays open
//     to everyone — and this nav is the marketing chrome any future public page
//     will reuse. Those pages will not carry the redirect, and a nav that
//     offered a signed-in visitor `Log in` would be wrong on them;
//   * the session can appear after the guard has already run — signing in
//     another tab, or a token refresh landing late. The nav follows the store,
//     so it stays correct instead of showing a stale `Sign up free` to someone
//     who now has an account.
//
// So: `Log in` / `Sign up free` when anonymous, `Go to dashboard` when not.
//
// NOTHING FROM THE APP SHELL. No `App_HorizontalNav`, no `Provider_Organization`,
// no `useQ_*` hook. Reusing the in-app nav is the obvious shortcut and it would
// drag the notification bell, the org switcher and the whole query layer onto a
// page whose entire job is to load fast for a stranger. The only cross-domain
// import here is the auth store, which `main.tsx` has already initialised.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, Drawer, Space, Typography, theme } from "antd";
import { FileProtectOutlined, MenuOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import { useStore_Auth_Loading, useStore_Auth_Session } from "@/stores/Store_Auth";

/** Height of the sticky bar. Sections use it as their `scrollMarginTop`. */
export const const_MarketingNav_Height = 64;

export type MarketingNav_Section = {
    id: string;
    label: string;
    /** Scrolls the section into view inside the layout's scroll container. */
    onSelect: () => void;
};

type Props = {
    sections: MarketingNav_Section[];
};

export const App_MarketingNav = ({ sections }: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const session = useStore_Auth_Session();
    const loading = useStore_Auth_Loading();
    const [drawerOpen, setDrawerOpen] = useState(false);

    const handleSelect = (section: MarketingNav_Section) => {
        setDrawerOpen(false);
        section.onSelect();
    };

    // One tick passes between mount and Supabase's INITIAL_SESSION event. Showing
    // the logged-out buttons during it makes the bar visibly swap for anyone with
    // a session; a fixed-width placeholder keeps the layout still instead.
    const authArea = loading ? (
        <div style={{ width: 168, height: 32 }} aria-hidden />
    ) : session ? (
        <Link to="/home">
            <Button type="primary">Go to dashboard</Button>
        </Link>
    ) : (
        <Space size={token.marginXS}>
            <Link to="/login">
                <Button type="text">Log in</Button>
            </Link>
            <Link to="/signup">
                <Button type="primary">Sign up free</Button>
            </Link>
        </Space>
    );

    return (
        <div
            style={{
                // Sticky INSIDE the layout's scroll container, not fixed to the
                // viewport — the marketing frame scrolls a div, not the document.
                // z-index stays far below `#portal`'s 9999 so modals and toasts
                // still overlay the bar.
                position: "sticky",
                top: 0,
                zIndex: 10,
                height: const_MarketingNav_Height,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: token.margin,
                padding: `0 ${isMobile ? token.paddingMD : token.paddingLG}px`,
                paddingLeft: `calc(${
                    isMobile ? token.paddingMD : token.paddingLG
                }px + var(--app-safe-left))`,
                paddingRight: `calc(${
                    isMobile ? token.paddingMD : token.paddingLG
                }px + var(--app-safe-right))`,
                // Translucent rather than solid: the hero's gradient reads through
                // it as the page scrolls, which is why the blur is here too.
                background: "rgba(255, 255, 255, 0.82)",
                backdropFilter: "blur(12px)",
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
        >
            <Link
                to="/"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: token.marginXS,
                    color: "inherit",
                }}
            >
                <FileProtectOutlined style={{ fontSize: 22, color: token.colorPrimary }} />
                <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
                    ContractGo
                </Typography.Text>
            </Link>

            {isMobile ? (
                <Space size={token.marginXS}>
                    {authArea}
                    <Button
                        type="text"
                        icon={<MenuOutlined />}
                        aria-label="Open menu"
                        onClick={() => setDrawerOpen(true)}
                    />
                    <Drawer
                        open={drawerOpen}
                        onClose={() => setDrawerOpen(false)}
                        placement="right"
                        width={260}
                        title="ContractGo"
                    >
                        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
                            {sections.map((section) => (
                                <Button
                                    key={section.id}
                                    type="text"
                                    block
                                    style={{ textAlign: "left" }}
                                    onClick={() => handleSelect(section)}
                                >
                                    {section.label}
                                </Button>
                            ))}
                        </Space>
                    </Drawer>
                </Space>
            ) : (
                <>
                    <Space size={token.marginXS}>
                        {sections.map((section) => (
                            <Button
                                key={section.id}
                                type="text"
                                onClick={() => handleSelect(section)}
                            >
                                {section.label}
                            </Button>
                        ))}
                    </Space>
                    {authArea}
                </>
            )}
        </div>
    );
};
