# Vertical nav extraction with org-chart-only menu

Work Item: [AHR-317](https://plane.jimbui.dev/aiur/browse/AHR-317/)
Tier 1: [AHR-313] [v0.0.1 | App Shell] Layout extraction & content overflow fix (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The App Shell's collapsible sidebar nav is inlined in the protected route file (~60 lines). Extract it into a self-contained component that shows only the Org Chart menu item, org switcher, and view switcher mock.
Tech: `routes/_protected/route.tsx` lines 131–189 (Sider JSX), `stores/Store_Sidebar.ts` (rename to Store_VerticalNav), `components/app-shell/const_AppShell_Dimensions.ts`, `components/organization/App_OrgSwitcher.tsx`, `components/app-shell/App_ViewSwitcherMock.tsx`
Related: None — standalone extraction within App Shell module.
Siblings: 5 total, 0 Done — [AHR-315 Layout constants (Done, local pending /pp), AHR-316 Horizontal nav (Done, local pending /pp), AHR-317 Vertical nav (Todo) ←, AHR-318 Auth container (Todo), AHR-319 Content overflow (Todo)]
Execution Order: Step 2 of 3 — Step 1 (AHR-315) done locally ✓

## Phase A: Rename Store_Sidebar → Store_VerticalNav

- [x] Rename `src/stores/Store_Sidebar.ts` → `Store_VerticalNav.ts`, update all internal names: `State_Sidebar` → `State_VerticalNav`, `Store_Sidebar` → `Store_VerticalNav`, `useStore_Sidebar_Collapsed` → `useStore_VerticalNav_Collapsed`, `Store_Sidebar_Actions` → `Store_VerticalNav_Actions`
- [x] Update imports in `routes/_protected/route.tsx` and `components/app-shell/App_HorizontalNav/App_HorizontalNav.tsx` to use new store path and names

## Phase B: Create App_VerticalNav and wire into route

- [x] Create `src/components/app-shell/App_VerticalNav.tsx` — zero-prop, self-hiding component. Internal hooks: `useStore_VerticalNav_Collapsed`, `useMatch({ from: '/_protected/$organizationId', shouldThrow: false, select: (m) => m.params.organizationId })`, `useLocation()`, `theme.useToken()`. Uses `const_AppShell_VerticalNavWidth` / `const_AppShell_VerticalNavCollapsedWidth` / `const_AppShell_HorizontalNavHeight`. Only Org Chart menu item (no Dashboard). Renders `App_ViewSwitcherMock` and `App_OrgSwitcher` in footer. No `onBreakpoint`. Returns null when not in org-scoped route.
- [x] In `_protected/route.tsx`: replace inline Sider block with `<App_VerticalNav />`, remove all Sider-specific imports and computed values. Route file is now a pure compositor (guard + components + Outlet).

---

## Plane IDs (populated by /pp)

Phase A: AHR-366

- Task 1: AHR-367
- Task 2: AHR-368

Phase B: AHR-369

- Task 1: AHR-370
- Task 2: AHR-371
