// The signing-ceremony layout — one of the route tree's unguarded branches
// (`_marketing` and `_trial` are the others; see the frame note at the bottom).
//
// It is a real layout route with an `<Outlet/>`, not a wrapper component:
// `bible-tanstack-router` forbids wrapping shared frames in a component,
// because a wrapper re-mounts its subtree on every child navigation and loses
// the frame's state.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO:
//
//   * no `beforeLoad` session check. `_protected` redirects anonymous users to
//     login; a signer is not a member of the sending organization, so that guard
//     would make the product's core surface unreachable. A signer DOES have to be
//     signed in as their own address before `Page_Sign` shows them anything, but
//     that check belongs to the page and not to this route: it needs the signer's
//     email out of `signing_session_open` to know which account to demand, and a
//     `beforeLoad` runs before there is a session to read it from. This route
//     also carries the CC observer's read-only link, which requires no account
//     at all.
//   * no `_auth`-style redirect-if-authenticated either. A logged-in ContractGo
//     user may legitimately be a signer on someone else's document — bouncing
//     them to their dashboard would strand them.
//
// The chrome is standalone: a brand bar and nothing else. No org switcher, no
// navigation, no account menu — none of it resolves for someone with no
// session, and offering it would imply the signer has an account here.
//
// The brand links to `/`, the public landing page.
//
// That link was a dead end until CG-052, and the note that used to sit here
// recorded it as an accepted trade: `/` lived under `_protected`, so for the
// visitor this surface mostly carries — an external counterparty with no
// ContractGo account — the logo led to a sign-in wall rather than to anything
// they could use. It also recorded the fix: "a public landing route rather than
// a different `to=` here". That is what shipped. The dashboard moved to
// `/home`, `/` is now the marketing page under the unguarded `_marketing`
// layout, and the logo finally leads somewhere a signer can actually read.
//
// `target="_blank"` STAYS, and not for the old reason. It protects a half-filled
// ceremony from an accidental in-place navigation — a signer three fields into a
// document should not lose that work to a stray logo click. Landing on a useful
// page instead of a login wall does not make losing the ceremony acceptable, so
// that decision is untouched by this change.
//
// THREE PUBLIC FRAMES, and they cannot be one layout. This is the ceremony
// frame: fixed height, brand-only chrome. `_trial` copies the height contract
// below but carries converting chrome, because its entire job is to convert
// where this route's job is explicitly NOT to imply the signer has an account.
// `_marketing` is a scrolling frame, which this route cannot be for the
// `height`-vs-`min-height` reason spelled out on the container below.

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Typography, theme } from "antd";
import { FileProtectOutlined } from "@ant-design/icons";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";

export const Route = createFileRoute("/_public")({
    component: PublicLayout,
});

function PublicLayout() {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();

    return (
        <div
            style={{
                // `height`, NOT `min-height`: the signing page is a fixed-height
                // frame whose document pane scrolls internally, and every
                // `height: 100%` inside it needs a DEFINITE height to resolve
                // against. Under `min-height` those percentages fall back to
                // `auto`, the PDF pane grows to the full document height, and the
                // step's footer — the only way to reach step 3 — is pushed below
                // the fold where `body { overflow: hidden }` makes it unreachable.
                //
                // `--app-vh` is `100dvh` where supported and `100vh` otherwise. On
                // a phone the difference IS the URL bar, and under `100vh` the
                // footer this comment is about lands underneath it.
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
                {/* A router <Link>, not an <a>: `/` is a route in this app's own
                    tree, and a raw href would throw away the SPA and reload the
                    whole bundle.

                    NEW TAB, which is unusual for an internal link and is the
                    point. The signing page holds a half-filled ceremony — typed
                    field values and, on the last step, a drawn signature, all of
                    it local state that no server has yet. Navigating away in
                    place would discard a signer's work on a stray click of
                    something that looks like decoration, and the back button
                    would not bring it back. */}
                <Link
                    to="/"
                    target="_blank"
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
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    // A safety net for the short standalone screens the signing page
                    // returns outside its own frame (the receipt, the "cannot open"
                    // results): the fixed frame above would otherwise clip them on a
                    // small window with no way to scroll.
                    overflow: "auto",
                    padding: isMobile ? token.paddingSM : token.paddingLG,
                    paddingLeft: `calc(${
                        isMobile ? token.paddingSM : token.paddingLG
                    }px + var(--app-safe-left))`,
                    paddingRight: `calc(${
                        isMobile ? token.paddingSM : token.paddingLG
                    }px + var(--app-safe-right))`,
                }}
            >
                <Outlet />
            </div>
        </div>
    );
}
