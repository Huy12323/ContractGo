# View type wiring — grid selectable in view switcher

Work Item: AHR-1188 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1188/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context (from spec)

Non-tech: A third view type (`grid`) is added to the Employees page alongside the existing `chart` and `list` views. Selecting Grid renders the Glide Data Grid body instead of the ANTD table — everything else (toolbar, saved-views sidebar, filters/sort/group state) stays identical.

Tech: `ViewMode` in `Page_Employees.tsx` is a local `useState` (`'chart' | 'list'`). The Segmented switcher at line ~397 offers the two options. The view type is NOT persisted to saved views — it's an ephemeral UI mode. Saved views (`employee_views` table) are scoped to the List/Grid body only and carry sort/filter/group/hidden/order/widths. `PageEmployees_ListView` is the host of the List branch, and owns the toolbar + saved-views sidebar + renders `<App_EmployeeDataTable>`.

Related: Employee Management spec (above) — "Employees list view" bullets describe the current ANTD table the Grid will replace.

Siblings: 4 total, 0 Done — AHR-1188 (this, Todo), AHR-1189 Grid render (Todo), AHR-1190 Column controls (Todo), AHR-1191 Sort/filter/group (Todo)
Execution Order: Step 1 of 3 — foundation, no prerequisites ✓

## Design decision

Not a new parallel page. Add a `renderer?: 'table' | 'grid'` prop to `PageEmployees_ListView` (default `'table'`). Grid mode reuses the entire toolbar + sidebar + saved-view state — only the body component swaps. This gives a true apples-to-apples comparison and makes the future Table → Grid replacement a one-line default change.

## Phase A: Install Glide Data Grid

- [x] `pnpm --filter frontend/vite add @glideapps/glide-data-grid`
- [x] Verify peer deps satisfied (Glide needs `marked`, `react-responsive-carousel` as optional peers — skip unless required for our use)
- [x] Confirm package.json recorded and lockfile committed

## Phase B: Wire the third view type

- [x] In `Page_Employees.tsx`: extend `type ViewMode = 'chart' | 'list'` → `'chart' | 'list' | 'grid'`
- [x] Add third `Segmented` option with `AppstoreOutlined` (or similar) + `value: 'grid'`
- [x] Add a third branch in the view-content render: `viewMode === 'grid'` → `<PageEmployees_ListView organizationId={organizationId} renderer="grid" />`
- [x] Add `renderer?: 'table' | 'grid'` prop on `PageEmployees_ListView` with default `'table'`
- [x] Inside `PageEmployees_ListView`, branch the body: `renderer === 'grid'` → render stub `<App_EmployeeDataGrid ... />` with identical props to `App_EmployeeDataTable`; else keep existing `<App_EmployeeDataTable ... />`

## Phase C: Stub grid component

- [x] Create `frontend/vite/src/components/employees/App_EmployeeDataGrid.tsx`
- [x] Export `App_EmployeeDataGrid` with the same prop signature as `App_EmployeeDataTable` (organizationId, fieldOrder, fieldWidths, hiddenKeys, sortState, filterState, groupBy, onColumnResize, onColumnOrderChange, onAddField, onEditField, onHideField)
- [x] Body: placeholder — `<div>Grid view coming soon — AHR-1189</div>` wrapped in the same flex-1 container the Table uses
- [x] No Glide integration yet (that's T2-B)

## Phase D: Sanity check

- [x] Dev server up, navigate to `/org_XXX/employees`
- [x] Toggle Chart → List → Grid; List renders existing table; Grid renders placeholder; Chart renders chart
- [x] No console errors; toolbar + sidebar render identically in both List and Grid
- [x] Reload page: viewMode defaults back to `chart` (expected — not persisted)

---

## Plane IDs (populated by /pp)

Phase A: AHR-1194
- Task 1: AHR-1198
- Task 2: AHR-1199
- Task 3: AHR-1200

Phase B: AHR-1195
- Task 1: AHR-1201
- Task 2: AHR-1202
- Task 3: AHR-1203
- Task 4: AHR-1204
- Task 5: AHR-1205

Phase C: AHR-1196
- Task 1: AHR-1206
- Task 2: AHR-1207
- Task 3: AHR-1208
- Task 4: AHR-1209

Phase D: AHR-1197
- Task 1: AHR-1210
- Task 2: AHR-1211
- Task 3: AHR-1212
- Task 4: AHR-1213
