# Empty-state for zero views + composer-driven first-view creation

Work Item: [AHR-942](https://plane.jimbui.dev/aiur/browse/AHR-942/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: When an organization has zero saved views, the views sidebar shows a single "No views yet" empty state with a "Create your first view" button, and the table area shows a matching placeholder. When the org has views but none is selected (no `viewId` in the URL), auto-select the first view so the user always sees a functioning table.

Tech: Drop the synthetic "Default" row from `PageEmployees_ViewsSidebar.tsx:145-162`. Add an empty-state branch at the top of the sidebar body that replaces search + list when `employeeViews.length === 0`. Add a `useEffect` in `PageEmployees_ListView.tsx` that auto-navigates to the first view when `viewId` is undefined and views exist. Add an ANTD `<Empty>` placeholder in the table area when `activeView === null`. Tables: `employee_views` (no schema changes). Files: `PageEmployees_ViewsSidebar.tsx`, `PageEmployees_ListView.tsx`, plus the existing `PageEmployees_ViewNameModal` is reused (no edits needed).

Related: Sibling `AHR-946` (sidebar UI polish — borderless search + borderless `+` button) is sequenced AFTER AHR-942 to avoid same-file conflicts.

Siblings: 6 total, 0 Done — AHR-941 Auto-save + toolbar (Done local, pending /pp), AHR-942 (this, planned local), AHR-943 Field composer + single_select (Done local, pending /pp), AHR-944 Table column controls (Planned local / in progress this round), AHR-945 Contract template + soft delete (Done local, pending /pp), AHR-946 Sidebar polish (Not started).

Execution Order: Step 2 of 3 — prerequisites all effectively Done ✓ (AHR-941, AHR-943, AHR-945 are locally complete). Parallel with AHR-944.

## Phase A: Remove virtual "Default" row from sidebar

- [x] Edit `PageEmployees_ViewsSidebar.tsx`: delete the `<div>` block at lines 145-162 that renders the pinned "Default" row
- [x] Delete the "Divider when saved views exist" block that sat between the Default row and the saved views list — no longer needed with the Default row gone
- [x] Verify `navigate({ to: '.', search: { viewId: undefined } })` no longer has a UI trigger anywhere (Default row was the only caller)
- [x] Confirm no references to `activeViewId === undefined` remain in the sidebar (was used to style the Default row as active)

## Phase B: Empty-state when `employeeViews.length === 0`

- [x] In `PageEmployees_ViewsSidebar.tsx`, at the top of the return (before the search + list render), add an early-return branch:
  - When `qViews.query.isSuccess && qViews.employeeViews.length === 0`, return a sidebar shell with only the empty state (no search input, no "New view" button)
  - Centered vertically within the sidebar width (240px)
  - Content: ANTD `<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No views yet" />` + below it a primary `<Button icon={<PlusOutlined />} onClick={onCreateView}>Create your first view</Button>`
- [x] Keep the sidebar's outer container styling (width 240, border-right, colorBgContainer) for layout consistency
- [x] When `qViews.query.isLoading`, show a subtle loading state (reuse existing ANTD `<Spin />` or `<Skeleton />` pattern) so the empty state doesn't flash during initial load

## Phase C: Auto-select first view + table placeholder

- [x] In `PageEmployees_ListView.tsx`, add a `useEffect([search.viewId, qViews.employeeViews, qViews.query.isSuccess])` that:
  - Returns early if `qViews.query.isSuccess === false` (still loading)
  - Returns early if `search.viewId` is already defined (user already on a view)
  - Returns early if `qViews.employeeViews.length === 0` (no views to select — empty-state handles it)
  - Otherwise, navigates to the first view: `navigate({ to: '.', search: { viewId: qViews.employeeViews[0].id } })`
- [x] Guard the navigate call to run only once per `viewId` transition — use a ref to track the last auto-selected id so the effect doesn't loop if the user manually clears the URL
- [x] In the table area (`<App_EmployeeDataTable>` wrapper), add a conditional:
  - When `activeView === null && qViews.query.isSuccess`, render ANTD `<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Create a view to get started" />` centered in the table area instead of `<App_EmployeeDataTable>`
  - When `activeView === null && qViews.query.isLoading`, render a matching loading state (subtle, not a full loader)
  - Otherwise, render `<App_EmployeeDataTable>` as today
- [x] Verify the table area placeholder only appears when `employeeViews.length === 0`; when views exist, the auto-select effect kicks in fast enough that the placeholder is never seen

## Phase D: Verify integration

- [x] Run `pnpm type-check` — clean (no ts errors)
- [x] Browser smoke: log into a fresh organization (no views) → sidebar shows empty state + "Create your first view" button; click → composer opens; submit → new view created + URL updates + table populates
- [x] Browser smoke: land on `/employees` URL with no `viewId` param while views exist → auto-selects the first view; URL updates
- [x] Browser smoke: delete the last remaining view from the sidebar → sidebar returns to empty state, table area returns to placeholder
- [x] Browser smoke: delete a non-last view → auto-select kicks in when the current view is the one deleted (existing delete handler already redirects — confirm still works with the new auto-select effect)

---

## Plane IDs (populated by /pp)

Phase A: AHR-1025
- Delete Default row block: AHR-1026
- Delete Divider block: AHR-1027
- Verify no UI triggers clear viewId: AHR-1028
- Confirm no activeViewId undefined refs: AHR-1029

Phase B: AHR-1030
- Empty-state branch: AHR-1031
- Sidebar shell styling: AHR-1032
- Loading spinner: AHR-1033

Phase C: AHR-1034
- Auto-select useEffect: AHR-1035
- Ref guard: AHR-1036
- Table area placeholder: AHR-1037
- Verify placeholder scope: AHR-1038

Phase D: AHR-1039
- Type-check: AHR-1040
- Fresh-org smoke: AHR-1041
- No-viewId auto-select smoke: AHR-1042
- Delete-last-view smoke: AHR-1043
- Delete-non-last-view smoke: AHR-1044
