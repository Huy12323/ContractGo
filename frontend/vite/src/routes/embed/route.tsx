// The EMBED layout — the signing ceremony as it appears inside someone else's
// page (CG-047, v1.4.0 Phase E).
//
// A real layout route with an `<Outlet/>`, not a wrapper component, for the
// reason `bible-tanstack-router` gives and `_public/route.tsx` already states: a
// wrapper re-mounts its subtree on every child navigation and loses the frame's
// state. Here that state is a half-filled contract.
//
// ═══ WHY `embed/` AND NOT `_embed/` ═══
//
// The leading underscore in this router means PATHLESS: `_public/sign.$token`
// serves `/sign/{token}`, with `_public` contributing chrome and no URL segment.
// So a sibling `_embed/sign.$token` would ALSO claim `/sign/{token}` — two
// routes, one path. The generator refuses it outright, which is the right
// failure and worth recording because the alternative was worse: had it silently
// picked one, the framed ceremony and the emailed one would have differed only
// by which file won a race.
//
// The path segment is also load-bearing OUTSIDE the router. `public/_headers`
// relaxes `frame-ancestors` for `/embed/*` and denies it everywhere else, and a
// static header file can only match a URL. A pathless embed layout would have
// been unaddressable by the very policy that makes it framable.
//
// ═══ WHY THIS IS NOT A LEAF UNDER `_public` ═══
//
// `_public/route.tsx` is the right chrome for a standalone tab and the wrong
// chrome for a 600px iframe on a customer's website:
//
//   * IT RENDERS A BRAND BAR. Our logo, sitting inside someone else's product,
//     is at best noise and at worst a claim about whose page the visitor is on.
//     The integrator's page already says who they are.
//   * IT PINS `height: var(--app-vh)`. That is the VIEWPORT height — the height
//     of the whole browser window, not of the iframe. Inside a frame it would
//     size the ceremony to the host's window and let the document overflow the
//     element it is actually in, putting the footer (the only way to reach the
//     next step) below the frame's bottom edge with no way to scroll to it.
//     This layout sizes to `100%` of its container instead, which inside an
//     iframe IS the frame.
//   * ITS BRAND LINK OPENS `/`, which lives behind `_protected`'s guard. A
//     signer has no account here, so it leads to a login wall — tolerable as
//     chrome in a tab, and simply wrong inside an integration.
//
// ═══ WHAT IT DELIBERATELY DOES NOT DO ═══
//
// No guard of any kind — neither `_protected`'s redirect-to-login nor `_auth`'s
// redirect-if-authenticated. The reasoning is `_public`'s verbatim and does not
// weaken here: the token is the credential, the signer is not a member of the
// sending organization, and a logged-in ContractGo user may legitimately be a
// signer on someone else's document.
//
// ═══ FRAMING ═══
//
// `public/_headers` denies framing across the whole app and relaxes it for
// `/embed/*` alone. Read that file's comment before widening anything: the
// relaxation cannot be per-tenant from a static header, so the real defence on
// this path is the short-lived, use-capped, origin-pinned credential and NOT the
// CSP.

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { theme } from "antd";

export const Route = createFileRoute("/embed")({
    component: EmbedLayout,
});

function EmbedLayout() {
    const { token } = theme.useToken();

    return (
        <div
            style={{
                // `100%`, never `var(--app-vh)` — see the header. The host sizes
                // the iframe; this fills exactly what it is given.
                height: "100%",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                // The host's page has its own background and its own padding
                // around the frame. Ours is only what the ceremony needs to be
                // readable, and deliberately smaller than `_public`'s: every
                // pixel here is spent out of an element someone else sized.
                background: token.colorBgLayout,
                padding: token.paddingSM,
                overflow: "auto",
            }}
        >
            <Outlet />
        </div>
    );
}
