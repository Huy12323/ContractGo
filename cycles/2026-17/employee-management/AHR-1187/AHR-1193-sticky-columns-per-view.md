# Sticky columns — per-saved-view freeze count

Work Item: AHR-1193 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1193/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context

Non-tech: Each saved view can independently pin N leftmost columns during horizontal scroll. User right-clicks a column header → chooses "Freeze up to this column". Airtable semantics.

Tech: Glide's `freezeColumns: number` prop already does the rendering — the missing piece is persistence per saved view. `employee_views` schema gets a new integer column; `EmployeeView_Config` type gains the field; existing `useM_EmployeeView_Update` optimistic mutation handles it via any-field patching. Grid reads `activeView.freeze_columns`, passes to DataEditor.

Design decisions:
- **One column, not a range.** `freeze_columns: integer DEFAULT 0` — count of leftmost frozen visible columns. 0 = no freeze. Matches Glide's API 1:1.
- **No schema migration of the existing `config` JSONB.** `freeze_columns` is a flat column on `employee_views`, same level as `field_order` / `field_widths` / `hidden_keys` etc. (all columns in that table were already split out by AHR-941.)
- **Clean config util (`Utils_EmployeeView_CleanConfig.ts`) passes through `freeze_columns` unchanged** — it's a count, not a column reference, so there's no cleanup on column-delete.
- **Menu UX:** one item visible at a time. If `freeze_columns > 0`, show "Unfreeze all". Otherwise show "Freeze up to this column". Keeps the menu short.
- **Scope of this T2:** only the Grid's column header menu. Toolbar doesn't get a separate freeze control — keeps the surface small.

## Phase A: Migration

- [ ] `pnpm sb:dev:new ahr1193_employee_views_freeze_columns`
- [ ] Write SQL: `ALTER TABLE public.employee_views ADD COLUMN freeze_columns INTEGER NOT NULL DEFAULT 0;`
- [ ] Apply local: `pnpm sb:dev:push`
- [ ] Regenerate types: `pnpm sb:dev:types`
- [ ] Lint: `supabase db lint --local`

## Phase B: Type + mutation plumbing

- [ ] Add `freeze_columns: number` to `EmployeeView_Config` in `src/types/employeeTable.types.ts`
- [ ] Add `freeze_columns?: number` to `UseM_EmployeeView_Update_Body` in `src/hooks/useM_EmployeeView_Update.ts`
- [ ] Query hook `useQ_Tables_OrgEmployeeViews` uses `select('*')` — already picks up the new column for free
- [ ] `PageEmployees_ListView.tsx`: derive `freezeColumns = (activeView?.freeze_columns as number | null) ?? 0` and pass to `App_EmployeeDataGrid`
- [ ] `Utils_EmployeeView_CleanConfig.ts`: verify the util already preserves unknown fields (it does — it only strips column references; `freeze_columns` is a count so no change needed). Confirm via read-through.

## Phase C: Grid reads freeze count from prop

- [ ] Add `freezeColumns?: number` to `App_EmployeeDataGrid` Props (default 0)
- [ ] Replace hardcoded `freezeColumns={1}` on DataEditor with `freezeColumns={freezeColumns ?? 0}`
- [ ] Accept the prop in the component signature destructure

## Phase D: Header menu UX

- [ ] In `App_EmployeeDataGrid`, compute current freeze count per render: `const frozenCount = freezeColumns ?? 0`
- [ ] Build dynamic menu items:
  - Existing: Edit, Hide, Delete
  - Insert new item conditionally between Hide and Delete:
    - If `frozenCount === 0`: `{ key: 'freeze', icon: <PushpinOutlined />, label: 'Freeze up to this column' }`
    - If `frozenCount > 0`: `{ key: 'unfreeze', icon: <PushpinOutlined />, label: 'Unfreeze all columns' }`
- [ ] Extend `handleMenuClick`:
  - `freeze` → call a new callback prop `onSetFreezeColumns?.(menu.colIndex + 1)`
  - `unfreeze` → `onSetFreezeColumns?.(0)`
- [ ] Add `onSetFreezeColumns?: (n: number) => void` to Grid Props
- [ ] `PageEmployees_ListView.tsx` wires this callback to `patchActiveView({ freeze_columns: n })`

## Phase E: Smoke test

- [ ] Grid view, click a column header menu → menu shows "Freeze up to this column"
- [ ] Click it → leftmost column(s) up to and including the clicked column become sticky on horizontal scroll
- [ ] Open menu on any column → now shows "Unfreeze all columns"
- [ ] Click Unfreeze → freeze cleared
- [ ] Switch saved views — each view retains its own freeze count
- [ ] Reload page — freeze count persists

---

## Plane IDs (populated by /pp)

Phase A: AHR-1327
- Task 1: AHR-1332
- Task 2: AHR-1333
- Task 3: AHR-1334
- Task 4: AHR-1335
- Task 5: AHR-1336

Phase B: AHR-1328
- Task 1: AHR-1337
- Task 2: AHR-1338
- Task 3: AHR-1339
- Task 4: AHR-1340
- Task 5: AHR-1341

Phase C: AHR-1329
- Task 1: AHR-1342
- Task 2: AHR-1343
- Task 3: AHR-1344

Phase D: AHR-1330
- Task 1: AHR-1345
- Task 2: AHR-1346
- Task 3: AHR-1347
- Task 4: AHR-1348
- Task 5: AHR-1349

Phase E: AHR-1331
- Task 1: AHR-1350
- Task 2: AHR-1351
- Task 3: AHR-1352
- Task 4: AHR-1353
- Task 5: AHR-1354
- Task 6: AHR-1355
