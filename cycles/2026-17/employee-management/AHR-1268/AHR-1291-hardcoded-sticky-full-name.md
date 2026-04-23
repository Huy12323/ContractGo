# Full-name derived column + read-only column convention > Hardcoded sticky first column + remove freeze config

Work Item: [AHR-1291](https://plane.jimbui.dev/aiur/browse/AHR-1291/)
Tier 1: [AHR-1268](https://plane.jimbui.dev/aiur/browse/AHR-1268/) [v0.0.1 | Employee Management] Full-name derived column + read-only column convention (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The employees grid will display a single "Full Name" column as its first column, always sticky during horizontal scroll. It replaces the just-shipped user-configurable freeze feature — one pinned column is the only behavior the product needs. `__`-prefixed columns are system-managed: they can't be reordered, hidden, or removed, and right-clicking them does nothing.

Tech: `__full_name` (from AHR-1289 migration) becomes the first entry in `EmployeeDataTable_UniversalFields`. `App_EmployeeDataGrid` hardcodes `freezeColumns={1}` to Glide, forces `__full_name` at index 0 of `fields` regardless of `fieldOrder`, rejects moves to/from index 0, and suppresses the header menu entirely for `__`-prefixed columns. `PageEmployees_ListView` drops all `freeze_columns` plumbing and filters `__`-prefixed keys out of the Hide-fields panel and drag-reorder toolbar (but keeps them available for Sort/Group/Filter). `employee_views.freeze_columns` column is dropped; `UseM_EmployeeView_Update_Body` and `EmployeeView_Config` drop the field.

Glide compatibility: `getCellContent([col, row])` maps `col` → `visibleFields[col]` → reads field by key from the row record. Since `.select("*")` already returns `__full_name` (post-AHR-1289 types regen), no query-side change is needed; rendering the frozen column works through the existing render path.

Related: AHR-1289 DB column + types (Done local, pending /pp) — delivered the `__full_name` column this T2 consumes. See `cycles/2026-17/employee-management/AHR-1268/AHR-1289-full-name-generated-column.md`.

Siblings: 2 total, 1 Done — AHR-1289 DB column + edge function guard (Done local, pending /pp), AHR-1291 Hardcoded sticky first column + remove freeze config (In Progress, this)
Execution Order: Step 2 of 2 — Step 1 (AHR-1289) Done local ✓

## Phase A: DB + types cleanup

- [x] Create migration `frontend/vite/supabase/migrations/20260420154000_ahr1291_drop_employee_views_freeze_columns.sql` — `ALTER TABLE public.employee_views DROP COLUMN freeze_columns;`
- [x] Apply migration: `supabase db push --local`
- [x] Regenerate types: `pnpm sb:dev:types` — `freeze_columns` removed from `employee_views.Row/Insert/Update` (grep count: 0)
- [x] Remove `freeze_columns: number` from `EmployeeView_Config` in `frontend/vite/src/types/employeeTable.types.ts`
- [x] Remove `freeze_columns?: number` from `UseM_EmployeeView_Update_Body` in `frontend/vite/src/hooks/useM_EmployeeView_Update.ts`

## Phase B: Grid + Page

- [x] Add `__full_name` as first entry in `EmployeeDataTable_UniversalFields`; also added `isSystemFieldKey` helper for consistent `__`-prefix detection
- [x] In `App_EmployeeDataGrid.tsx`: dropped `freezeColumns` and `onSetFreezeColumns` from `Props`; removed `PushpinOutlined` import and freeze/unfreeze menu items + handler branches
- [x] In `App_EmployeeDataGrid.tsx`: `fields` useMemo splits into `system` + `rest`, system always first (ignores any `fieldOrder` positioning)
- [x] In `App_EmployeeDataGrid.tsx`: `visibleFields` keeps system keys even if in `hiddenKeys`
- [x] In `App_EmployeeDataGrid.tsx`: added `onColumnProposeMove` handler returning `false` for `from === 0 || to === 0` — blocks the visual drag preview before Glide animates a swap with the sticky column. `handleColumnMoved` keeps the same check defensively.
- [x] In `App_EmployeeDataGrid.tsx`: `handleHeaderMenuClick` returns early (doesn't open menu) when field key is system-prefixed
- [x] In `App_EmployeeDataGrid.tsx`: `<DataEditor freezeColumns={1} />` hardcoded
- [ ] Verify Glide cell rendering via browser — pending (see Phase C)
- [x] In `PageEmployees_ListView.tsx`: removed `freezeColumns` local, `freeze_columns` from `patchActiveView` patch type, and both props from the `<App_EmployeeDataGrid>` call site
- [x] In `PageEmployees_ListView.tsx`: added `reorderableFields` memo (listViewFields minus system keys); `hideFieldsFiltered` + "Hide all" button now derive from it. Sort / Group / Filter pickers still use the full `listViewFields`

## Phase C: Verify

- [x] `pnpm tsc --noEmit` — only the three pre-existing errors remain (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx` — TanStack router/history, unrelated to this change). No new errors introduced by this T2.
- [ ] Browser verification — **not performed**. The existing browser tab on localhost:5173 belongs to a different project (Spark). Starting our dev server on a separate port + fresh login was out of scope; leaving this for manual verification.
- [ ] Saved views load without residual `freeze_columns` reads — covered by typecheck passing (TypeScript would flag any leftover reference), but not browser-verified
- [ ] Dynamic column create/edit/hide/reorder regression check — not browser-verified

**Manual verification checklist** (for PM review):
1. Open `/employees` — Full Name is the first column
2. Scroll the grid horizontally — Full Name stays pinned to the left edge
3. Right-click the Full Name header — nothing happens (no menu)
4. Open Hide-fields panel — Full Name is not listed; only the other fields are
5. Open Sort / Group / Filter pickers — Full Name IS listed
6. Create / edit / hide / reorder a dynamic column — still works normally
7. Rename or reload a saved view — no console errors referencing `freeze_columns`

---

## Plane IDs (populated by /pp)

Phase A: AHR-1365

- Task 1: AHR-1366
- Task 2: AHR-1367
- Task 3: AHR-1368
- Task 4: AHR-1369
- Task 5: AHR-1370

Phase B: AHR-1371

- Task 1: AHR-1372
- Task 2: AHR-1373
- Task 3: AHR-1374
- Task 4: AHR-1375
- Task 5: AHR-1376
- Task 6: AHR-1377
- Task 7: AHR-1378
- Task 8: AHR-1379
- Task 9: AHR-1380
- Task 10: AHR-1381

Phase C: AHR-1382

- Task 1: AHR-1383
- Task 2: AHR-1384
- Task 3: AHR-1385
- Task 4: AHR-1386
