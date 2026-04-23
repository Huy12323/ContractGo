# Schema + edge fn + types

Work Item: AHR-1493 (https://plane.jimbui.dev/aiur/browse/AHR-1493/)
Tier 1: AHR-1492 [v0.0.1 | Employee Management] File column type (Todo)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
Version Doc: https://outline.jimbui.dev/doc/5d80c0fb-cf52-4785-a819-f84c92251b56

## Context (from spec)

Non-tech: Teach the backend about a new "file" column type for employees. After this, the system can create a file column (no UI yet — the column-add modal and cell rendering come in sibling T2s).
Tech: One-line enum migration + two edits in `employee-management_create-column` edge fn + types regen. `'file'` maps to PG type `text` (stores `files.id`). The existing `add_employee_column` RPC already accepts `'text'`, no RPC change needed.
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — this T1 is the first real consumer of its infra.
Siblings: 2 total, 0 Done — AHR-1494 Field composer UI (Todo), AHR-1495 Table cell (Todo) — both blocked until this ships
Execution Order: Step 1 of 2 — foundation; no prerequisites

## Phase A: Enum migration

- [x] Create migration file `frontend/vite/supabase/migrations/YYYYMMDDHHMMSS_ahr1493_employee_column_type_add_file.sql` with single statement: `ALTER TYPE employee_column_type ADD VALUE 'file';`
- [x] Apply locally: `pnpm supabase db push --local` → succeeds without error
- [x] Lint: `pnpm supabase db lint --local` → 0 warnings

## Phase B: Edge function update

- [x] Edit `frontend/vite/supabase/functions/employee-management_create-column/index.ts`:
    - `PG_TYPE_MAP`: add `file: "text"` entry
    - `VALID_TYPES`: add `"file"` to the array
- [x] No change to `add_employee_column` RPC (its `allowed_types` already includes `'text'`)

## Phase C: Types regen

- [x] `pnpm sb:dev:types` from repo root (or equivalent project type-regen command)
- [x] Verify `frontend/vite/src/types/database.types.ts` diff shows `employee_column_type` union gains `| "file"`
- [x] Verify no unrelated changes (should only be the one enum union line)

## Phase D: Smoke

- [x] `pnpm tsc --noEmit` from `frontend/vite/` → 0 new errors
- [x] Restart `pnpm dev` so edge fn picks up new code
- [x] Obtain real `organization_id` + user JWT (admin/owner of that org) via Supabase Studio / auth.users
- [x] POST `employee-management_create-column` with `{label: "AHR-1493 Test File", type: "file", organization_id: "<real>"}` + Bearer JWT → 201, returned `column.type === "file"`
- [x] Verify in Studio: `employee_columns` row exists with `type='file'`; running `\d employees` (or Studio table inspector) shows a physical `col_xxx` TEXT column added to `employees`
- [x] Cleanup: `DELETE FROM employee_columns WHERE id = '<returned id>'` → `drop_physical_col_on_delete` trigger removes the TEXT column from `employees`
- [x] Verify cleanup: `\d employees` no longer shows the test column

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Create migration file: (pending)
- Apply locally: (pending)
- Lint: (pending)

Phase B: (pending)

- PG_TYPE_MAP entry: (pending)
- VALID_TYPES entry: (pending)

Phase C: (pending)

- sb:dev:types regen: (pending)
- Verify diff: (pending)

Phase D: (pending)

- tsc check: (pending)
- Restart dev: (pending)
- Acquire JWT + org: (pending)
- Create file column via edge fn: (pending)
- Verify physical column: (pending)
- Delete column + verify trigger drop: (pending)
