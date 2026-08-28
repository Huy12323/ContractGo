// The trial layout — the frame around the no-account signing trial (CG-052).
//
// WHY THIS IS NOT `_public`, AND NOT `_marketing`.
//
// It needs `_public`'s frame: `height: var(--app-vh)` with `overflow: hidden`,
// because the trial is a document editor whose PDF pane scrolls internally, and
// every `height: 100%` inside it needs a DEFINITE height to resolve against.
// Under `min-height` those percentages fall back to `auto`, the pane grows to
// the full document height, and the step footer is pushed below the fold where
// `body { overflow: hidden }` makes it unreachable. That is the failure
// `_public/route.tsx` documents at length, so the frame is COPIED from it
// deliberately. It rules out living under `_marketing`, which scrolls.
//
// But it must not BE `_public`, because that layout's chrome is brand-only by
// explicit design: "no org switcher, no navigation, no account menu — none of it
// resolves for someone with no session, and offering it would imply the signer
// has an account here." The trial's job is the exact opposite. Its visitor has
// no account and the entire point is to offer them one, so this frame carries a
// `Sign up free` call to action that would be wrong on the ceremony.
//
// Same height contract, opposite chrome. Copy the contract, not the file.
//
// NO GUARD, like the other two public branches. Reaching the trial must never
// require a session — that is the product being demonstrated.

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Button, Typography, theme } from "antd";
import { FileProtectOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

export const Route = createFileRoute("/_trial")({
    component: TrialLayout,
});

function TrialLayout() {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        <div
            style={{
                height: "var(--app-vh)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: token.colorBgLayout,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: token.marginXS,
                    padding: isMobile
                        ? `${token.paddingXS}px ${token.paddingMD}px`
                        : `${token.paddingSM}px ${token.paddingLG}px`,
                    paddingLeft: `calc(${
                        isMobile ? token.paddingMD : token.paddingLG
                    }px + var(--app-safe-left))`,
                    paddingRight: `calc(${
                        isMobile ? token.paddingMD : token.paddingLG
                    }px + var(--app-safe-right))`,
                    background: token.colorBgContainer,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    flexShrink: 0,
                }}
            >
                {/* In place, NOT a new tab — the opposite of the ceremony's brand
                    link, and for the same underlying reason. There the tab holds
                    a half-filled ceremony that a stray click must not discard;
                    here it holds a demo the visitor can redo in a minute, and
                    spawning tabs from a page someone is only trying out is its
                    own kind of rude. */}
                <Link
                    to="/"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: token.marginXS,
                        color: "inherit",
                    }}
                >
                    <FileProtectOutlined
                        style={{ fontSize: isMobile ? 18 : 20, color: token.colorPrimary }}
                    />
                    <Typography.Text
                        strong
                        style={{ fontSize: isMobile ? token.fontSize : token.fontSizeLG }}
                    >
                        ContractGo
                    </Typography.Text>
                </Link>

                <Link to="/signup">
                    <Button type="primary" size={isMobile ? "small" : "middle"}>
                        Sign up free
                    </Button>
                </Link>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <Outlet />
            </div>
        </div>
    );
}
