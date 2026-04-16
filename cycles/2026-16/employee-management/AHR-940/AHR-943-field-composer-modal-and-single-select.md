# Field composer modal + single_select type

Work Item: [AHR-943](https://plane.jimbui.dev/aiur/browse/AHR-943/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Replace the existing "Manage Fields" modal with a single composer modal that handles create + edit + delete for all column types. Add a new `single_select` column type that mirrors `multi_select` for storage but renders as a single tag and uses single-value filter operators. Composer is launched from the table's `+` column header (CREATE) and from the per-column chevron context menu (EDIT) — both wired by AHR-944.

Tech: New component `App_EmployeeFieldComposerModal` (~280 lines, fresh write). ALTER TYPE migration adds `single_select` to `employee_column_type` ENUM. Reuses `employee_column_choices` table for both single/multi select choices. Edge function `employee-management_create-column` updated to accept `choices: string[]` for both select types (rename body field from `options`). `const_EmployeeColumnsTypeOptions` (per `bible-supabase-options`) updated for the new enum value. Choices editor uses dnd-kit for reorder. Deletes `App_FieldManagerModal`, `App_CreateFieldModal`, the "Manage Fields" button in `Page_Employees.tsx`, and the "Manage" button in `App_FormBuilderModal.tsx`. Tables: `employee_columns`, `employee_column_choices`. Files: new `App_EmployeeFieldComposerModal.tsx`; edits to `Page_Employees.tsx`, `App_FormBuilderModal.tsx`, `const_EmployeeColumnsTypeOptions.ts`, `employeeTable.types.ts`, `PageEmployees_ListView.tsx` (operators map), edge function `index.ts`.

Related: AHR-944 (column controls) — wires the composer entry points (chevron menu Edit/Delete + `+` column CREATE). AHR-944 is sequenced *after* AHR-943 in execution order Step 2.

Siblings: 6 total, 0 Done — AHR-941 Auto-save + toolbar (planned local), AHR-942 Empty-state (Not started), AHR-943 (this, planned local), AHR-944 Column controls (Not started), AHR-945 Contract template + soft delete (planned local), AHR-946 Sidebar polish (Not started).

Execution Order: Step 1 of 3 — all done ✓ (no prerequisites; parallel with AHR-941 + AHR-945).

## Phase A: ENUM migration

- [x] Create migration `2026XXXXXXXXXX_ahr943_employee_column_type_add_single_select.sql`
- [x] `ALTER TYPE employee_column_type ADD VALUE 'single_select';` (cannot be in a transaction block — verify migration runner handles it or split into pre-commit)
- [x] Apply migration via Supabase CLI per `bible-supabase-cli`
- [x] Regenerate types via `pnpm sb:dev:types`
- [x] Verify `Enums<'employee_column_type'>` now includes `'single_select'`

## Phase B: Type updates

- [x] Edit `frontend/vite/src/types/employeeTable.types.ts`: change `EmployeeTable_FieldType` to `"text" | "number" | "date" | "boolean" | "single_select" | "multi_select"`
- [x] Add `OPERATORS_BY_TYPE.single_select = [{equals}, {not_equals}, {is_empty}, {is_not_empty}]` in `PageEmployees_ListView.tsx` (filter operator map)

## Phase C: Edge function update

- [x] Edit `frontend/vite/supabase/functions/employee-management_create-column/index.ts`
- [x] Rename body field from `options: string[]` to `choices: string[]`
- [x] Branch: if `type === 'single_select' || type === 'multi_select'` → insert into `employee_column_choices` with `sort_order` matching array index (existing pattern)
- [x] Verify CORS, env loading, RLS still work
- [x] No need to alter `employee_columns` schema for either select type — both use `employee_column_choices`

## Phase D: const_EmployeeColumnsTypeOptions update

- [x] Edit `frontend/vite/src/hooks/const_EmployeeColumnsTypeOptions.ts`
- [x] Add entry: `single_select: { value: 'single_select', label: 'Single select', icon: <UnorderedListOutlined /> }` (or appropriate icon — confirm during build)
- [x] Verify TypeScript build still passes — the `Record<Enums<'employee_column_type'>, ...>` constraint will require this entry once the enum has `single_select`

## Phase E: Build composer modal

- [x] Create `frontend/vite/src/components/employees/App_EmployeeFieldComposerModal.tsx`
- [x] Props: `{ open: boolean, onClose: () => void, organizationId: string, mode: 'create' | 'edit', columnId?: string }`
- [x] State: `label`, `type`, `choices` (array of `{ id?: string, label: string }`)
- [x] Width 480px, centered (ANTD default)
- [x] Form rows: Label `Input`, Type `Select` (sourced from `const_EmployeeColumnsTypeOptions.options`, disabled in edit mode)
- [x] Conditional Choices section: only when `type === 'single_select' || type === 'multi_select'`
- [x] EDIT mode: hydrate from `useQ_Tables_EmployeeColumns` for column metadata + `useQ_Tables_EmployeeColumnChoices` for choices
- [x] Submit: CREATE calls edge function (port from `App_FieldManagerModal.mCreateField` lines 77-103, with `choices` body field); EDIT updates label via SDK direct + upserts choices via SDK (port `mUpdateField` lines 106-142)
- [x] On success: `queryClient.invalidateQueries(QueryKeys.employee_columns.all())` + `QueryKeys.employee_column_choices.all()`, close modal, toast "Field created" / "Field updated"
- [x] Validation: empty label disables submit (existing pattern)

## Phase F: Choices editor (dnd-kit reorder)

- [x] Inside composer, render choices as a sortable list using `@dnd-kit/core` + `@dnd-kit/sortable` (already in project — see view sidebar reorder for pattern)
- [x] Each choice row: drag handle (`<HolderOutlined />`) on the left, label `Input` in the middle, delete `Button` (`type="text"` + `<MinusCircleOutlined />`) on the right
- [x] "+ Add choice" button at bottom (matches existing `App_FieldManagerModal` line 300-302 pattern but with consistent token styling)
- [x] On reorder: update local `choices` state to reflect new index order; on submit, the upsert loop sends `sort_order: index`

## Phase G: Cleanup

- [x] Delete `frontend/vite/src/components/employees/App_FieldManagerModal.tsx`
- [x] Delete `frontend/vite/src/components/employees/App_CreateFieldModal.tsx` (unused dead code)
- [x] Edit `Page_Employees.tsx`: remove `App_FieldManagerModal` import, remove `fieldManagerOpen` state, remove the "Manage Fields" button (line 313 area), remove the modal mount (line 517)
- [x] Edit `App_FormBuilderModal.tsx`: remove `App_FieldManagerModal` import (line 36), remove `fieldManagerOpen` state (line 110), replace the "Manage" button (line 533) with a "+ Add field" button that opens `App_EmployeeFieldComposerModal` in CREATE mode (no list/browse UI inside form builder), remove the modal mount (line 761)
- [x] Verify nothing else imports the deleted components (`App_FieldManagerModal`, `App_CreateFieldModal`) — grep before commit

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Migration creation: (pending)
- Apply locally: (pending)
- Regenerate types: (pending)

Phase B: (pending)
- FieldType union extend: (pending)
- Operators map entry: (pending)

Phase C: (pending)
- Edge function rename body field: (pending)
- Branch for both select types: (pending)

Phase D: (pending)
- Type options map entry: (pending)

Phase E: (pending)
- Composer skeleton: (pending)
- Form rows + conditional choices: (pending)
- EDIT mode hydration: (pending)
- Submit logic create + update: (pending)

Phase F: (pending)
- dnd-kit sortable choices: (pending)
- Add choice + delete row controls: (pending)

Phase G: (pending)
- Delete App_FieldManagerModal: (pending)
- Delete App_CreateFieldModal: (pending)
- Remove Page_Employees Manage Fields entry: (pending)
- Replace form builder Manage button: (pending)
