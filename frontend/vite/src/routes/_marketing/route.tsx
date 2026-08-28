// The marketing layout — the app's public front door, and the SECOND branch of
// the route tree with no guard (see `_public/route.tsx` for the first).
//
// THE FRAME IS THE WHOLE REASON THIS IS ITS OWN LAYOUT.
//
// `index.html` pins `html, body { overflow: hidden; height: 100dvh }` and
// `#root { height: 100% }`, because every other surface in the product is a
// fixed frame with internal scroll panes. A marketing page is the one surface
// that genuinely wants to be taller than the viewport, so it owns an internal
// scroll pane instead of asking the global frame to change. That is not a
// workaround: `_protected/route.tsx` and `_public/route.tsx` already scroll
// their content the same way. This is a taller instance of an existing idiom.
//
// The alternative — toggling `body { overflow }` from a `useEffect` — was
// rejected. It needs a new global rule, and worse it makes the frame invariant
// TEMPORARILY FALSE during route transitions: a mount-ordering race could leave
// `body` scrollable while the signing page is mounted, which is precisely the
// state that strands the signing ceremony's step footer below the fold.
//
// TWO CONSEQUENCES OF SCROLLING A DIV RATHER THAN THE DOCUMENT:
//
//   * In-page anchors cannot be `href="#id"`. The scrollable ancestor is this
//     div, so sections are reached with `ref.current?.scrollIntoView(...)` and
//     each one carries a `scrollMarginTop` matching the sticky nav's height.
//   * The mobile URL bar will not auto-collapse — browsers only do that for
//     DOCUMENT scroll. Nothing is clipped or unreachable, because `--app-vh` is
//     `100dvh` and was therefore measured WITH the bar showing; the page is
//     just ~60px shorter per screen. A cosmetic cost, and the right trade
//     against destabilising the frame every other surface depends on.
//
// THREE PUBLIC FRAMES, NOT ONE. `_public` is the signing ceremony (fixed
// height, brand-only chrome by design). `_trial` copies that height contract
// but carries converting chrome. `_marketing` is this scrolling frame. They
// cannot be merged: a PDF pane resolving `height: 100%` inside a scrolling
// parent falls back to `auto` and grows to the full document height, which is
// the bug documented at `_public/route.tsx`'s height comment.

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_marketing")({
    component: MarketingLayout,
});

function MarketingLayout() {
    return (
        <div
            style={{
                height: "var(--app-vh)",
                overflowY: "auto",
                overflowX: "hidden",
                scrollBehavior: "smooth",
            }}
        >
            <Outlet />
        </div>
    );
}
