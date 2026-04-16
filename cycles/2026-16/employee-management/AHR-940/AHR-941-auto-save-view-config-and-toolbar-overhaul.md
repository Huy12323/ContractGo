# Auto-save view config + toolbar overhaul

Work Item: [AHR-941](https://plane.jimbui.dev/aiur/browse/AHR-941/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Convert the Employees list view from explicit Save / Save As / Cancel ceremony to fully auto-saved view config. Every toolbar interaction (sort, filter, group, hide fields) writes directly to the active view; toolbar moves to the right edge and replaces icon-only buttons with labelled buttons that show counts when active.

Tech: Schema split of `employee_views.config` JSONB into individual columns (filter, sort, group_by, hidden_keys, field_order, field_widths) for surgical per-column updates. Drop `Provider_Page_Employees_List` (savedConfig/isDirty/equalConfig machinery) — view query data is the single source of truth. Reuse `useM_EmployeeView_Update` with partial-patch shape. Filter type flattens from nested `EmployeeTable_FilterGroup | null` to `EmployeeTable_FilterCondition[]` (implicit AND). Tables: `employee_views`. Files: `PageEmployees_ListView.tsx` (1152 lines, the toolbar + interaction handlers), `Provider_Page_Employees_List.tsx` (deleted), `useM_EmployeeView_Update.ts`, `employeeTable.types.ts`, `database.types.ts` (regenerated).

Related: Realtime ([Outline](https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64)) — AHR-845 platform locally complete; mutation `invalidateQueries` provides instant single-tab feedback, realtime adds cross-tab/user via the hybrid policy in `ext-tanstack-query-mutation`.

Siblings: 6 total, 0 Done — AHR-941 (this, planned local), AHR-942 Empty-state for zero views (Not started), AHR-943 Field composer + single_select (planned local), AHR-944 Table column controls (Not started), AHR-945 Contract template mgmt + soft delete (planned local), AHR-946 Sidebar UI polish (Not started).

Execution Order: Step 1 of 3 — all done ✓ (no prerequisites; parallel with AHR-943 + AHR-945).

## Phase A: Schema split — promote config sub-keys to columns

- [x] Create migration `2026XXXXXXXXXX_ahr941_employee_views_split_config.sql`
- [x] Phase 1 (in migration): ADD COLUMN `filter JSONB NOT NULL DEFAULT '[]'::jsonb` on `employee_views`
- [x] Phase 2 (in migration): ADD COLUMN `sort JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 3 (in migration): ADD COLUMN `group_by JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 4 (in migration): ADD COLUMN `hidden_keys JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 5 (in migration): ADD COLUMN `field_order JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 6 (in migration): ADD COLUMN `field_widths JSONB NOT NULL DEFAULT '{}'::jsonb`
- [x] Phase 7 (in migration): DROP COLUMN `config` (implicit wipe of any existing nested filters — pre-launch)
- [x] Apply migration via Supabase CLI per `bible-supabase-cli`
- [x] Regenerate types via `pnpm sb:dev:types`

## Phase B: Type updates

- [x] Edit `frontend/vite/src/types/employeeTable.types.ts`: drop `EmployeeTable_FilterGroup`, drop `EmployeeTable_FilterNode`, drop `kind` discriminator from `EmployeeTable_FilterCondition`
- [x] Add `field_widths: Record<string, number>` to `EmployeeView_Config` (keep `EmployeeView_Config` type as a render-time aggregation, even though DB now stores per-column)
- [x] Confirm new shape: `EmployeeView_Config = { filter: FilterCondition[], sort: SortEntry[], group_by: GroupEntry[], hidden_keys: string[], field_order: string[], field_widths: Record<string, number> }` — note snake_case to match DB columns
- [x] Update `useQ_Tables_OrgEmployeeViews.ts` SELECT projection to include all 6 new columns
- [x] Verify `Tables_OrgEmployeeViews_QueryData` row shape includes the new columns

## Phase C: Mutation hook for partial patches

- [x] Update `useM_EmployeeView_Update.ts`: `UseM_EmployeeView_Update_Body` becomes `{ viewId: string, name?: string, filter?: FilterCondition[], sort?: SortEntry[], group_by?: GroupEntry[], hidden_keys?: string[], field_order?: string[], field_widths?: Record<string, number> }`
- [x] Mutation function: pass `patch` (everything except `viewId`) directly to `.update(patch).eq('id', viewId)` — Supabase ignores undefined keys
- [x] Suppress success toast when only config keys are in the patch (silent auto-save); keep "View renamed" toast when `name` is present alone
- [x] Keep `queryClient.invalidateQueries({ queryKey: QueryKeys.employee_views.all() })` per hybrid policy

## Phase D: Provider deletion + ListView refactor

- [x] Delete `frontend/vite/src/providers/employees/Provider_Page_Employees_List.tsx` entirely
- [x] Remove the `<Provider_Page_Employees_List>` wrapper from `Page_Employees.tsx`
- [x] In `PageEmployees_ListView.tsx`: drop all `useProvider_Page_Employees_List`, `pList.state.savedConfig`, `pList.isDirty`, `pList.setToolState`, `pList.state.toolState`, `Utils_EmployeeView_CleanConfig` references
- [x] Replace with: read active view directly via `qViews.views.find(v => v.id === search.viewId)` and project fields onto local read-only consts (`filter`, `sort`, `groupBy`, `hiddenKeys`, `fieldOrder`, `fieldWidths`)
- [x] Drop `handleSaveCurrentView`, `handleSaveAs`, `handleCancelChanges` callbacks entirely
- [x] Drop the hydration `useEffect` that synced `savedConfig` from server (no longer needed — server is the only state)

## Phase E: Toolbar UI rework

- [x] Remove the absolute-positioned middle cluster — toolbar tools now live in a right-aligned cluster (`marginLeft: auto` after the left cluster of sidebar-toggle + view-name)
- [x] Reorder buttons: **Hide Fields → Filters → Groups → Sort**
- [x] Each button: `<Button>` with icon + label (no Tooltip-only); active state styling: `style={{ background: token.colorPrimaryBg, color: token.colorPrimary, borderColor: token.colorPrimaryBg }}`
- [x] Active label format: replace base label with count phrase
  - `"Hide fields"` ↔ `"{N} hidden"` (when `hidden_keys.length > 0`)
  - `"Filters"` ↔ `"Filtered by {N}"` (when `filter.length > 0`)
  - `"Groups"` ↔ `"Grouped by {N}"` (when `group_by.length > 0`)
  - `"Sort"` ↔ `"Sorted by {N}"` (when `sort.length > 0`)
- [x] Remove the Search button + popover entirely (icons + state + `toolState.search` + filter-by-search logic)
- [x] Remove Save / Save As / Cancel Changes buttons + their handlers + the `nameModal` state for "Save view as"
- [x] Keep `PageEmployees_ViewNameModal` only for view CREATE / RENAME flows from the sidebar (not save-as)

## Phase F: Wire toolbar interactions to surgical mutations

- [x] Sort popover: each `updateSortEntry` / `removeSortEntry` / drag-reorder calls `mUpdateView.mutation.mutate({ viewId, sort: nextSort })`
- [x] Filter editor: replace nested-group rendering with flat condition list; add/remove/edit calls `mUpdateView.mutation.mutate({ viewId, filter: nextFilter })`
- [x] Filter input typing (text/number conditions): wrap value commit in a debounced setter (400ms) — implement local `useDebouncedCallback` or use `useEffect` with `setTimeout` cleanup
- [x] Group popover: every change → `mUpdateView.mutation.mutate({ viewId, group_by: nextGroupBy })`
- [x] Hide Fields popover: every checkbox toggle → `mUpdateView.mutation.mutate({ viewId, hidden_keys: nextHiddenKeys })`
- [x] Update `OPERATORS_BY_TYPE` map (the one in `PageEmployees_ListView` lines 48-85) to drop the `kind` and `combinator` references and match new flat shape

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Migration creation: (pending)
- Apply locally: (pending)
- Regenerate types: (pending)

Phase B: (pending)
- Type flatten: (pending)
- Query projection update: (pending)

Phase C: (pending)
- Mutation hook upgrade: (pending)
- Toast suppression: (pending)

Phase D: (pending)
- Provider delete: (pending)
- ListView read-from-query refactor: (pending)
- Save/Cancel handler removal: (pending)

Phase E: (pending)
- Toolbar layout to right: (pending)
- Reorder buttons: (pending)
- Active state styling: (pending)
- Count phrase labels: (pending)
- Search/Save/Save-As/Cancel removal: (pending)

Phase F: (pending)
- Sort wiring: (pending)
- Filter wiring + debounce: (pending)
- Group wiring: (pending)
- Hide Fields wiring: (pending)
- Operators map update: (pending)
