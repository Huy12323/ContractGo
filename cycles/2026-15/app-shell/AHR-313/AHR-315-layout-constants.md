# Layout constants and shared dimensions

Work Item: [AHR-315](https://plane.jimbui.dev/aiur/browse/AHR-315/)
Tier 1: [AHR-313] [v0.0.1 | App Shell] Layout extraction & content overflow fix (Todo)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The App Shell provides the navigation frame for the entire application — a sticky top navbar and collapsible sidebar. Layout dimensions must be consistent across all components that participate in the shell layout.
Tech: `routes/_protected/route.tsx` currently uses inline magic numbers: Header height 48, Sider width 240, collapsedWidth 64, calc(100vh - 48px). These need a single source of truth.
Related: None — this is a standalone constants file consumed by sibling T2s.
Siblings: 5 total, 0 Done — [AHR-315 Layout constants (Todo) ←, AHR-316 Horizontal nav (Todo), AHR-317 Vertical nav (Todo), AHR-318 Auth container (Todo), AHR-319 Content overflow (Todo)]
Execution Order: Step 1 of 3 — no prerequisites (this is the foundation)

## Phase A: Create constants file

- [x] Create `src/components/app-shell/const_AppShell_Dimensions.ts` with three exported constants: `const_AppShell_HorizontalNavHeight` (48), `const_AppShell_VerticalNavWidth` (240), `const_AppShell_VerticalNavCollapsedWidth` (64)
- [x] Verify values match current inline magic numbers in `_protected/route.tsx` (height: 48, width: 240, collapsedWidth: 64, calc top: 48)

---

## Plane IDs (populated by /pp)

Phase A: AHR-339

- Task 1: AHR-340
- Task 2: AHR-341
