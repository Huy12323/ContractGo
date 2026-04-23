# Deprecate ANTD Table — remove App_EmployeeDataTable and list view mode

Work Item: AHR-1192 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1192/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context (from spec)

Non-tech: The Grid view has proven out at read-parity with the Table view (and faster in practice). Promote it to the sole list-body. Remove the ANTD `App_EmployeeDataTable` implementation and the `list` view switcher option. Chart + Grid are the only two view modes going forward.

Tech: Three files currently reference `App_EmployeeDataTable.tsx`:
- `Page_Employees.tsx` — imports nothing directly but has the `'list'` branch
- `PageEmployees_ListView.tsx` — imports `App_EmployeeDataTable`, `EmployeeDataTable_UniversalFields`, `FieldTypeIcon`, `type EmployeeDataTable_TableField`, and branches between `<App_EmployeeDataTable>` / `<App_EmployeeDataGrid>` via a `renderer` prop
- `App_EmployeeDataGrid.tsx` — imports `EmployeeDataTable_UniversalFields`, `type EmployeeDataTable_TableField` from the Table file (ergonomic accident; should pull from a neutral place)

`FieldTypeIcon` is also re-imported by `PageEmployees_ListView.tsx` for the toolbar's Hide Fields / Filters / Groups / Sort dropdowns (icon prefix in field-picker options).

Siblings: 5 total — AHR-1188 ✓, AHR-1189 ✓, AHR-1190 ✓, AHR-1191 ✓, AHR-1192 (this)
Execution Order: Step 4 (new, added after Step 3) — all prerequisite T2s are locally complete and the Grid is shipped and verified.

## Design decisions

- **Move, don't rename.** `EmployeeDataTable_UniversalFields` and `type EmployeeDataTable_TableField` keep their names — only change the file they live in. Rationale: minimize churn on the Grid (already using these) and on the toolbar's `optionRender` calls.
- **Target file for schema-ish exports:** `@/types/employeeTable.types.ts` (already the home of field-type / sort / filter types). Universal fields + `TableField` type slot in naturally.
- **Target file for `FieldTypeIcon`:** new standalone component file `src/components/employees/App_EmployeeFieldTypeIcon.tsx`. Pure ANTD-icon mapping function, no deps beyond `@ant-design/icons` and the field-type enum.
- **`PageEmployees_ListView`'s `renderer` prop goes away.** Body always renders `<App_EmployeeDataGrid>`. Keep the `ListView` name — "list" as a concept (rows of records) is still accurate even if the render is a grid.
- **Scope boundary:** the toolbar, saved-view CRUD, Hide Fields / Filters / Groups / Sort, `PageEmployees_ViewsSidebar` are all untouched. They already pass state through to the body; the body's identity changing from Table to Grid is invisible to them.
- **`react-resizable` dep:** check if anything else in the repo uses it. If not, remove from `package.json` + lockfile.

## Phase A: Extract shared symbols from App_EmployeeDataTable

- [x] Add `EmployeeDataTable_UniversalFields` + `type EmployeeDataTable_TableField` to `src/types/employeeTable.types.ts`
- [x] Create `src/components/employees/App_EmployeeFieldTypeIcon.tsx` exporting `FieldTypeIcon` (and the named `App_EmployeeFieldTypeIcon` alias if the naming bible requires it — but keep `FieldTypeIcon` export live for the toolbar's existing import)
- [x] Update `App_EmployeeDataGrid.tsx` imports: pull `EmployeeDataTable_UniversalFields` + `EmployeeDataTable_TableField` from `@/types/employeeTable.types` instead of from the Table file
- [x] Update `PageEmployees_ListView.tsx` imports: pull `EmployeeDataTable_UniversalFields`, `EmployeeDataTable_TableField` from types; pull `FieldTypeIcon` from the new component file

## Phase B: Remove list view mode + renderer prop

- [x] In `Page_Employees.tsx`: change `type ViewMode = 'chart' | 'list' | 'grid'` → `'chart' | 'grid'`. Default state stays `'chart'`.
- [x] Remove the `{ value: 'list', icon: <UnorderedListOutlined /> }` Segmented option. Keep `grid` + `chart`.
- [x] Remove the `UnorderedListOutlined` import if no other usage remains
- [x] Collapse the three-way view branch to two: chart branch + `<PageEmployees_ListView organizationId={organizationId} />` for grid
- [x] In `PageEmployees_ListView.tsx`: remove `renderer?: 'table' | 'grid'` from `Props`; remove the destructure default; replace the ternary body with a single `<App_EmployeeDataGrid ... />`
- [x] Remove `App_EmployeeDataTable` import from `PageEmployees_ListView.tsx`

## Phase C: Delete App_EmployeeDataTable.tsx

- [x] Remove the file `src/components/employees/App_EmployeeDataTable.tsx`
- [x] Grep the repo for any remaining imports — should be zero after Phase A/B
- [x] Confirm `Utils_EmployeeTable_Engine.ts` is still the shared engine (it is — both the now-deleted Table and the Grid used it; Grid is the sole consumer going forward)

## Phase D: Clean up unused deps + imports

- [x] Check `package.json` — is `react-resizable` used anywhere else? If not, `pnpm --filter @aiur-hr/web remove react-resizable react-resizable/css`
- [x] Check `@types/react-resizable` dev dep similarly
- [x] Remove any lingering imports or references surfaced by type-check
- [x] Run `pnpm type-check` — clean (aside from the pre-existing errors in auth forms + main.tsx)

## Phase E: Smoke test

- [x] Reload employees page — segmented shows Chart + Grid only (no List)
- [x] Default view mode is Chart; selecting Grid opens the Glide body with saved-view state intact
- [x] Toolbar Hide Fields / Filters / Groups / Sort popovers still show field-type icons in options (uses the relocated `FieldTypeIcon`)
- [x] No console errors
- [x] Browser check: column resize, reorder, freeze, header menu, group header collapse all still work

---

## Plane IDs (populated by /pp)

Phase A: AHR-1300
- Task 1: AHR-1305
- Task 2: AHR-1306
- Task 3: AHR-1307
- Task 4: AHR-1308

Phase B: AHR-1301
- Task 1: AHR-1309
- Task 2: AHR-1310
- Task 3: AHR-1311
- Task 4: AHR-1312
- Task 5: AHR-1313
- Task 6: AHR-1314

Phase C: AHR-1302
- Task 1: AHR-1315
- Task 2: AHR-1316
- Task 3: AHR-1317

Phase D: AHR-1303
- Task 1: AHR-1318
- Task 2: AHR-1319
- Task 3: AHR-1320
- Task 4: AHR-1321

Phase E: AHR-1304
- Task 1: AHR-1322
- Task 2: AHR-1323
- Task 3: AHR-1324
- Task 4: AHR-1325
- Task 5: AHR-1326
