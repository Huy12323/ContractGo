# Content area overflow fix with layout math

Work Item: [AHR-319](https://plane.jimbui.dev/aiur/browse/AHR-319/)
Tier 1: [AHR-313] [v0.0.1 | App Shell] Layout extraction & content overflow fix (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The App Shell's content area (where page content renders via Outlet) doesn't properly handle vertical overflow — long content pushes the page beyond the viewport instead of scrolling within the constrained layout.
Tech: `routes/_protected/route.tsx` ProtectedLayout — outer Layout has `minHeight: 100vh` (allows growth), inner Layout has no height constraint, Content has `overflow: auto` but no height limit. Needs `const_AppShell_HorizontalNavHeight` from `components/app-shell/const_AppShell_Dimensions.ts` for calc math.
Related: None — standalone fix within App Shell module.
Siblings: 5 total, 3 Done, 1 Cancelled — [AHR-315 Layout constants (Done), AHR-316 Horizontal nav (Done), AHR-317 Vertical nav (Done), AHR-318 Auth container (Cancelled), AHR-319 Content overflow (Todo) ←]
Execution Order: Step 3 of 3 — all prerequisites done ✓ (AHR-315 step 1, AHR-316 + AHR-317 step 2)

## Phase A: Apply viewport-locked layout with overflow scroll

- [x] Import `const_AppShell_HorizontalNavHeight` in `_protected/route.tsx` and apply height constraints — outer Layout `height: '100vh'` (replacing `minHeight: '100vh'`), inner Layout `height: calc(100vh - ${const_AppShell_HorizontalNavHeight}px)`
- [x] Update Content overflow styles — `overflowY: 'auto'` for vertical scrolling, `overflowX: 'hidden'` to prevent horizontal overflow (replacing current `overflow: 'auto'`), keep existing `padding: 24`

---

## Plane IDs (populated by /pp)

Phase A: AHR-376

- Task 1: AHR-377
- Task 2: AHR-378
