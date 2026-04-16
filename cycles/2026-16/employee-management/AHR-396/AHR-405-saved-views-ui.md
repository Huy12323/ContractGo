# Saved views UI

Work Item: [AHR-405](https://plane.jimbui.dev/aiur/browse/AHR-405/)
Tier 1: [AHR-396] [v0.0.1 | Employee Management] Employees page — saved views (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: HR curates a shared library of employee-table views (column order, hidden fields, sort, filter, group-by). All org members pick from the library; dirty in-memory changes can be saved, saved-as, or cancelled. A virtual "Default" view always exists and shows the universal fields with no tool state applied.
Tech: Thin UI layer on top of AHR-404's `employee_views` table. Adds a `Provider_Page_Employees_List` that owns tool state + `savedConfig` + `savedName` + dirty diff; `selectedViewId` read from the route search param. Sidebar subcomponent replaces the TODO placeholder in `Page_Employees.tsx` (lines 912–927). Existing stateless `App_EmployeeDataTable` stays unchanged — it already accepts every piece of persisted state via props. A DB AFTER DELETE trigger on `employee_columns` + a matching client util (`Utils_EmployeeView_CleanConfig`) strip references to deleted columns from view configs (belt & suspenders, per AHR-404 planning decision).
Related: Employee data table — list view (AHR-640, already done) — provides the stateless grid + the tool engine types this T2 persists.
Siblings: 2 total, 1 Done (effective) — AHR-404 Create employee_views table (Done, local pending /pp), AHR-405 Saved views UI (this)
Execution Order: Step 2 of 2 — AHR-404 prerequisite effectively Done (plan tasks all ticked, awaits /pp)

## Phase A: Data layer & types

- [x] `src/types/employeeTable.types.ts` — add `fieldOrder: string[]` field to `EmployeeTable_ToolState`; add new exported type `EmployeeView_Config = { sort: EmployeeTable_SortEntry[]; filter: EmployeeTable_FilterGroup | null; groupBy: EmployeeTable_GroupEntry[]; hiddenKeys: string[]; fieldOrder: string[] }` (all required — persisted shape, `search` deliberately excluded)
- [x] `src/types/database.override.types.ts` — wire `employee_views.Row.config: EmployeeView_Config`, `Insert.config: EmployeeView_Config`, `Update.config?: EmployeeView_Config` via `MergeDeep` (imports from `employeeTable.types.ts`). Also switched `configs/supabase/config.ts` to `createClient<DatabaseWithCustomTypes>` so the override applies at the SDK boundary
- [x] `src/utils/query/queryKeys.ts` — add `employeeViews: { all, list, record }` factory matching existing conventions
- [x] `src/hooks/useQ_Tables_OrgEmployeeViews.ts` — new query hook, `select("*").eq("organization_id", orgId).order("created_at", { ascending: true })`, returns `{ query, employeeViews }`
- [x] `src/hooks/useM_EmployeeView_Create.ts` — new mutation, params `()`, body `{ organization_id, name, config }`, `onSuccess` invalidates `QueryKeys.employeeViews.all()`, returns created row (for immediate navigation to new viewId). Feedback: `message.success("View created")`
- [x] `src/hooks/useM_EmployeeView_Update.ts` — new mutation, params `{ viewId }`, body `Partial<{ name, config }>`, invalidates `QueryKeys.employeeViews.all()`. Feedback: `message.success("View saved")` / `message.success("View renamed")` — caller picks via body shape
- [x] `src/hooks/useM_EmployeeView_Delete.ts` — new mutation, params `{ viewId }`, no body, invalidates `QueryKeys.employeeViews.all()`. Feedback: `message.success("View deleted")`

## Phase B: DB cleanup trigger + client util + created_by default

- [x] New migration `20260415083723_ahr405_employee_views_created_by_default.sql` — `ALTER TABLE public.employee_views ALTER COLUMN created_by SET DEFAULT auth.uid();` (so the Create mutation does not need to read the user id client-side)
- [x] New migration `20260415083722_ahr405_employee_views_column_cleanup_trigger.sql`:
  - `clean_employee_view_filter_node(node JSONB, deleted_field TEXT)` recursive helper — IMMUTABLE PL/pgSQL, returns NULL when fully pruned, prunes empty groups
  - `clean_employee_views_on_column_delete()` SECURITY DEFINER trigger function — iterates `employee_views` rows in the deleted column's `organization_id`, strips references to `OLD.id` from `fieldOrder`, `hiddenKeys`, `sort[].field`, `groupBy[].field`, and recursively walks `filter` tree
  - `trigger_clean_employee_views_on_column_delete AFTER DELETE ON public.employee_columns FOR EACH ROW`
- [x] Applied via `pnpm sb:dev:push`, regenerated types via `pnpm sb:dev:types`. Verified `created_by` default (`column_default: auth.uid()`) and trigger existence (`information_schema.triggers`). Lint shows pre-existing `public.authorize` issue (unrelated to this T2)
- [x] `src/utils/Utils_EmployeeView_CleanConfig.ts` — function overload preserves `EmployeeTable_FilterGroup` at the top level. Returns same reference if nothing changed (for React memoization)
- [x] Manual smoke verification covered by user-supplied recordings attached to the version doc at `/pp` time

## Phase C: Provider + route search schema

- [x] `src/routes/_protected/$organizationId/employees/index.tsx` — added `validateSearch` for `viewId?: string` (rejects non-string values)
- [x] `src/providers/employees/Provider_Page_Employees_List.tsx` — pure state provider following `bible-react-provider-context`. State class: `savedConfig`, `savedName`, `toolState`. Exports helpers `emptyToolState`, `emptyConfig`, `projectConfigFromToolState`, `equalConfig`. Hook `useProvider_Page_Employees_List` returns `{ state, setState, setToolState, isDirty }` — `setToolState` is ergonomic shortcut for partial toolState updates; `isDirty` is derived from deep-equal of `savedConfig` vs projected current config
- [x] Sync effect lives in `PageEmployees_ListView` (not the pure provider) — keyed on `[search.viewId, qViews data, qColumns data]` with a `lastHydratedViewIdRef` guard so dirty state survives background query refetches. Uses `Utils_EmployeeView_CleanConfig` with `validKeys = universal ∪ dynamic columns`
- [x] `isDirty` returned from the hook — deep equality excludes `search`
- [x] `src/pages/Page_Employees/Page_Employees.tsx` — extracted all list-view state, handlers, helpers, and JSX into `PageEmployees_ListView`. The remaining page just wraps the list branch in `<Provider_Page_Employees_List><PageEmployees_ListView organizationId={organizationId} /></Provider_Page_Employees_List>`. Chart branch untouched
- [x] Migrated list-view `useState` → provider `toolState`. Ergonomic setters (`setSortState`, `setFilterState`, `setGroupBy`, `setHiddenKeys`, `setFieldOrder`, `setSearchQuery`) accept value or functional updater so existing handler code ported 1:1. Drag refs + drop-hover state stayed as local `useState` in the ListView subcomponent

## Phase D: Views sidebar subcomponent

- [x] `src/pages/Page_Employees/PageEmployees_ViewsSidebar/PageEmployees_ViewsSidebar.tsx` — new page-scoped subcomponent. Props: `organizationId` + 4 action callbacks (`onCreateView`, `onRenameView`, `onDuplicateView`, `onDeleteView`). Internally reads `useQ_Tables_OrgEmployeeViews`, `useSearch`, `useNavigate`. Keeps sidebar-scoped search filter as local state (not persisted)
- [x] Layout — "Views" header + `Input` search with `SearchOutlined` prefix + "+ New View" `Button` (`type="dashed"`, `block`). Scrollable list area below
- [x] Rows — virtual "Default" pinned at top (no three-dot menu, `TableOutlined` icon), followed by filtered saved views. Active highlight uses `colorPrimaryBg`/`colorPrimary` tokens when `search.viewId` matches (or is `undefined` for Default). Click → `navigate({ to: '.', search: { viewId: row.id | undefined } })` (search param replace works since schema is single-field)
- [x] Three-dot menu — ANTD `Dropdown` with `MoreOutlined`. Items: Rename (EditOutlined) / Duplicate (CopyOutlined) / divider / Delete (DeleteOutlined, danger). Each menu click routes through the parent callback. Empty state when filter has no matches shows a "No views match your search" secondary text
- [x] Replaced placeholder in `PageEmployees_ListView.tsx` with `<PageEmployees_ViewsSidebar ... />`. Stub callbacks (noop) added in ListView for Phase E/F to replace

## Phase E: Shared name modal + Create/Rename wiring

- [x] `src/pages/Page_Employees/PageEmployees_ViewNameModal/PageEmployees_ViewNameModal.tsx` — reusable `Modal` + `Form` with single `Input`, autofocus, trim validation, `submitting` gate, `destroyOnHidden`
- [x] Wire "+ New View" → modal (Create mode) → `mCreateView.mutateAsync({ organization_id, name, config: projectConfigFromToolState(toolState) })` → `navigate({ to: '.', search: { viewId: created.id } })`. Sync effect auto-hydrates the provider state because the `lastHydratedViewIdRef` is still pointing at `null` (user was on Default)
- [x] Wire Rename menu item → modal (Rename mode, `initialName=view.name`) → `mUpdateView.mutateAsync({ viewId, name })`. Sync effect doesn't re-hydrate because the viewId didn't change, so in-flight dirty tool state survives rename
- [x] **Hook shape deviation (documented):** `useM_EmployeeView_Update` and `useM_EmployeeView_Delete` were refactored to take `viewId` at **mutate-time** (not hook-time) — the skill's canonical `{ viewId }` hook param shape doesn't fit three-dot menu UX where the hook would need to be instantiated per list row. Mutate-time id keeps a single hook instance per component. Mutation body: `{ viewId, name?, config? }` for Update; `{ viewId }` for Delete

## Phase F: Save / Save-as / Cancel Changes + Duplicate + Delete

- [x] Replaced disabled Save/Save-as buttons with three provider-driven buttons in toolbar:
  - `Save` (`type="primary"`) — `disabled={!savedConfig || !isDirty}`, `loading={mUpdateView.isPending}`. On click: `mUpdateView.mutateAsync({ viewId, config: projectConfigFromToolState(toolState) })`, then `pList.setState({ savedConfig: newConfig })` so `isDirty` flips back to false without waiting for refetch
  - `Save as view` — always enabled, `loading` when Save-As modal in flight. Opens name modal pre-filled `"Copy of {savedName}"` (empty on Default). On submit: `mCreateView.mutateAsync({ organization_id, name, config })` → `navigate({ search: { viewId: created.id } })` (sync effect hydrates on the new viewId)
  - `Cancel Changes` — visible only when `savedConfig && isDirty`. On click: `pList.setState({ toolState: { ...savedConfig, search: toolState.search } })` — preserves the ephemeral search string, restores all persisted fields to saved values
- [x] Wired Duplicate menu item — silent `mCreateView.mutateAsync({ name: \`Copy of ${view.name}\`, config: view.config })` + navigate. Matches `App_OnboardingFormsList.tsx:31` copy convention. No prompt
- [x] Wired Delete menu item — `modal.confirm({ title: "Delete view?", okType: "danger", onOk })`. On confirm: `mDeleteView.mutateAsync({ viewId })`, and if the deleted view was current, `navigate({ search: { viewId: undefined } })` to fall back to Default
- [x] **Stale-state fix:** Save and Rename now update `savedConfig`/`savedName` directly in provider state after `mutateAsync` resolves, because the sync effect's `lastHydratedViewIdRef` guard (designed to protect dirty state across query refetches) would otherwise leave stale `savedConfig` → `isDirty` stuck at `true` after save. Rename-of-current-view only (rename-of-other-view skips the local state write since the user isn't looking at it)
- [x] Manual verification done at `/pp` time — recordings attached to the version doc show create/save-as/delete flows

## Phase G: Drag-to-reorder views (scope extension, 2026-04-15)

- [x] Migration `20260415100726_ahr405_employee_views_sort_order.sql` — adds `sort_order INTEGER NOT NULL DEFAULT 0`, backfills existing rows per-org with `ROW_NUMBER() * 100`, indexes `(organization_id, sort_order)`
- [x] Migration `20260415100727_ahr405_employee_views_reorder_rpc.sql` — `reorder_employee_views(p_ids TEXT[])` SECURITY DEFINER RPC. Validates all ids exist and belong to one org, checks `is_admin_or_owner`, then renumbers each row to `(idx+1)*100`. Granted EXECUTE to authenticated
- [x] `useM_EmployeeView_Reorder` hook — calls the RPC. **Optimistic update:** `onMutate` cancels in-flight queries, snapshots current views, and writes the optimistic order (renumbered to `(idx+1)*100`) into the cache so the sidebar snaps instantly. `onError` rolls back to the snapshot + toast. `onSettled` invalidates to reconcile with server. Body needs `organizationId` to address the cache key
- [x] `useQ_Tables_OrgEmployeeViews` — query order changed from `created_at ASC` to `sort_order ASC, created_at ASC` (created_at is the tiebreak when integer collisions happen on midpoint inserts)
- [x] `useM_EmployeeView_Create` — body adds optional `sort_order?: number`. Caller computes (top vs after-source) and passes through
- [x] `PageEmployees_ViewsSidebar` — adds `HolderOutlined` drag handle to each saved-view row, HTML5 DnD with drop-indicator (matches existing sort/group/hide-popover pattern). Default row stays pinned (not draggable, not a drop target). Drag is disabled while the search filter is non-empty (would reorder a subset, which is misleading) — handle shows `cursor: not-allowed` in that state. New `onReorderViews` prop wires to the parent
- [x] `PageEmployees_ListView` — `mReorderViews` instantiated; `handleReorderViews` passes the ordered ids array to the RPC. Insert positions wired:
  - **Create / Save-As → top:** `sort_order = min(existing) - 100` (or `100` if empty). Eventually drifts negative; renormalized on next drag
  - **Duplicate → after source:** `Math.floor((source + next) / 2)` or `source + 100` if last. Collision (gap = 1) tiebreaks via `created_at ASC` so the new row still appears after its source
- [x] No new client-side cleanup util needed — column deletion only affects keys in `config`, not `sort_order`
- [x] **Layout refactor (post-feedback):** toolbar now spans the full list-view width with a hamburger (`MenuOutlined`) on the left that collapses/expands the sidebar. Previously the sidebar wrapped the toolbar vertically; now they are siblings under a shared column container — toolbar on top, then a flex-row with `{!sidebarCollapsed && <Sidebar />}` + table. Sidebar's "Views" header div removed (the hamburger provides the affordance, label is redundant)

---

## Plane IDs (populated by /pp)

Phase A: AHR-746

- Task 1 (Add fieldOrder + EmployeeView_Config type): AHR-748
- Task 2 (Wire JSONB override + switch SDK client): AHR-749
- Task 3 (Add employeeViews factory to queryKeys): AHR-750
- Task 4 (Create useQ_Tables_OrgEmployeeViews): AHR-751
- Task 5 (Create useM_EmployeeView_Create): AHR-752
- Task 6 (Create useM_EmployeeView_Update): AHR-753
- Task 7 (Create useM_EmployeeView_Delete): AHR-754

Phase B: AHR-755

- Task 1 (Migration created_by DEFAULT auth.uid): AHR-756
- Task 2 (Migration cleanup trigger + filter walker): AHR-757
- Task 3 (Apply migrations + regen types): AHR-758
- Task 4 (Utils_EmployeeView_CleanConfig): AHR-759
- Task 5 (Manual smoke verification): AHR-760

Phase C: AHR-761

- Task 1 (validateSearch for viewId): AHR-762
- Task 2 (Provider_Page_Employees_List): AHR-763
- Task 3 (Sync effect with hydration guard): AHR-764
- Task 4 (isDirty derived from hook): AHR-765
- Task 5 (Extract PageEmployees_ListView): AHR-766
- Task 6 (Migrate useState to provider toolState): AHR-767

Phase D: AHR-768

- Task 1 (PageEmployees_ViewsSidebar component): AHR-769
- Task 2 (Layout: header + search + New View): AHR-770
- Task 3 (Default + saved rows + navigation): AHR-771
- Task 4 (Three-dot menu): AHR-772
- Task 5 (Replace placeholder with sidebar): AHR-773

Phase E: AHR-774

- Task 1 (PageEmployees_ViewNameModal component): AHR-775
- Task 2 (Wire + New View → Create): AHR-776
- Task 3 (Wire Rename menu): AHR-777
- Task 4 (Refactor Update/Delete to mutate-time viewId): AHR-778

Phase F: AHR-779

- Task 1 (Wire Save / Save-as / Cancel toolbar): AHR-780
- Task 2 (Wire Duplicate silent Copy of): AHR-781
- Task 3 (Wire Delete + confirm): AHR-782
- Task 4 (Stale-state fix for savedConfig/savedName): AHR-783

Phase G: AHR-784

- Task 1 (Migration sort_order column + backfill): AHR-785
- Task 2 (Migration reorder_employee_views RPC): AHR-786
- Task 3 (useM_EmployeeView_Reorder + optimistic update): AHR-787
- Task 4 (Update Create body + query order): AHR-788
- Task 5 (Sidebar drag handle + HTML5 DnD): AHR-789
- Task 6 (ListView reorder wiring + insert-position helpers): AHR-790
- Task 7 (Layout refactor: collapsible sidebar): AHR-791
- Task 8 (Current view name + absolute-center middle cluster): AHR-792
