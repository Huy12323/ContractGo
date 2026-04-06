# Horizontal nav extraction with conditional sidebar toggle

Work Item: [AHR-316](https://plane.jimbui.dev/aiur/browse/AHR-316/)
Tier 1: [AHR-313] [v0.0.1 | App Shell] Layout extraction & content overflow fix (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The App Shell's top navbar (logo, avatar dropdown, sidebar toggle) is inlined in the protected route file. Extract it into a reusable component with proper route-based hamburger visibility.
Tech: `routes/_protected/route.tsx` lines 66–129 (Header JSX), `stores/Store_Sidebar.ts`, `hooks/useQ_Me.ts`, `components/app-shell/const_AppShell_Dimensions.ts`
Related: None — standalone extraction within App Shell module.
Siblings: 5 total, 0 Done — [AHR-315 Layout constants (Done, local pending /pp), AHR-316 Horizontal nav (Todo) ←, AHR-317 Vertical nav (Todo), AHR-318 Auth container (Todo), AHR-319 Content overflow (Todo)]
Execution Order: Step 2 of 3 — Step 1 (AHR-315) done locally ✓

## Phase A: Extract and wire App_HorizontalNav

- [x] Create `src/components/app-shell/App_HorizontalNav/App_HorizontalNav.tsx` — zero-prop component with Header JSX extracted from route file. Internal hooks: `useQ_Me()`, `theme.useToken()`, `useMatch({ from: '/_protected/$organizationId', shouldThrow: false, select: () => true })` for hamburger conditional. Uses `const_AppShell_HorizontalNavHeight` for height/lineHeight. Imports `Store_Sidebar_Actions.toggle` and `Store_Auth_Actions.signOut()` directly.
- [x] Replace inline Header in `_protected/route.tsx` with `<App_HorizontalNav />` and move Header-only imports (`MenuOutlined`, `LogoutOutlined`, `useQ_Me`, `Utils_String_GetInitials`) to the component. Keep `useLocation`, `useMatch`, sidebar imports in route file for sidebar logic.

---

## Plane IDs (populated by /pp)

Phase A: AHR-360

- Task 1: AHR-361
- Task 2: AHR-362
