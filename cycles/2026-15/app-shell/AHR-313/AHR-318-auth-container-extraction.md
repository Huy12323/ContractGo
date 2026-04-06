# Auth container extraction

Work Item: [AHR-318](https://plane.jimbui.dev/aiur/browse/AHR-318/)
Tier 1: [AHR-313] [v0.0.1 | App Shell] Layout extraction & content overflow fix (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The auth layout wraps all authentication pages (login, signup, forgot password, etc.) in a centered card with a gradient background. Currently this layout is inlined in the route file instead of being a proper reusable component.
Tech: `routes/_auth/route.tsx` contains ~30 lines of inline layout JSX (gradient background, centered card with shadow/border, `<Outlet />`). Extract to `src/components/app-shell/App_AuthContainer.tsx`. Uses `theme.useToken()` for ANTD tokens.
Related: None — standalone extraction, no cross-component dependencies.
Siblings: 5 total, 1 Done — [AHR-315 Layout constants (Done), AHR-316 Horizontal nav (Todo), AHR-317 Vertical nav (Todo), AHR-318 Auth container (Todo) ←, AHR-319 Content overflow (Todo)]
Execution Order: Step 2 of 3 — all done ✓ (AHR-315 foundation complete)

## Phase A: Extract auth container

- [x] Create `src/components/app-shell/App_AuthContainer.tsx` with gradient background (`linear-gradient(160deg, #d6e4ff 0%, #f0f5ff 30%, #fff1f0 70%, #e6f7ff 100%)`), centered card (max-width 420px, rounded, shadow, border), `<Outlet />` pass-through, using `theme.useToken()` for ANTD tokens
- [x] Update `_auth/route.tsx` — replace inline `AuthLayout` with `App_AuthContainer`, keep `beforeLoad` guard, remove `theme` import

---

## Plane IDs (populated by /pp)

Phase A: AHR-363

- Task 1: AHR-364
- Task 2: AHR-365
