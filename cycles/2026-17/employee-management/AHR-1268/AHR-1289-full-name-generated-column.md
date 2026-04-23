# Full-name derived column + read-only column convention > DB column + edge function guard

Work Item: [AHR-1289](https://plane.jimbui.dev/aiur/browse/AHR-1289/)
Tier 1: [AHR-1268](https://plane.jimbui.dev/aiur/browse/AHR-1268/) [v0.0.1 | Employee Management] Full-name derived column + read-only column convention (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Employees grid will display a single "Full Name" column as its sticky first column. That column is derived from `first_name + last_name` — read-only, always in sync, introduces a project-wide `__` prefix convention for system-managed columns on `employees`.

Tech: Adds `__full_name` to `public.employees` as `GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED`. Trim handles the empty-both case (defaults are `''`) so the grid treats empty rows as null-placeholder per the Airtable convention. Expression is IMMUTABLE — satisfies GENERATED column constraints. No backfill needed; Postgres computes for existing rows on `ALTER TABLE`.

Related: Edge function `employee-management_create-column` ([index.ts](../../../../frontend/vite/supabase/functions/employee-management_create-column/index.ts)) — does NOT need a guard because dynamic columns are named using row UUIDs (`col_name: column.id`), which can never start with `__`. FE `name.startsWith('__')` read-only check remains collision-safe.

Siblings: 2 total, 0 Done — AHR-1289 DB column + edge function guard (In Progress, this), AHR-1291 Hardcoded sticky first column + remove freeze config (Todo)
Execution Order: Step 1 of 2 — no prerequisites, AHR-1291 depends on this

## Phase A: Migration

- [x] Create migration `frontend/vite/supabase/migrations/20260420152824_ahr1289_employees_full_name_generated.sql` — `ALTER TABLE public.employees ADD COLUMN __full_name TEXT GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED;`
- [x] Apply migration locally via `supabase db push --local` (preserves data)
- [x] Verify in DB: `__full_name` populates correctly on existing rows; direct UPDATE rejected at engine level with `column "__full_name" can only be updated to DEFAULT`

## Phase B: Types

- [x] Regenerate types via `pnpm sb:dev:types`
- [x] `__full_name: string | null` appears under `employees.Row` (lines 501, 520, 539). Supabase type gen also includes it in `Insert`/`Update` as optional — a known quirk; runtime rejection at PG engine is the real guarantee.
- [x] `pnpm tsc --noEmit` surfaces only pre-existing errors in `App_LoginForm.tsx`, `App_SignUpForm.tsx`, and `main.tsx` (TanStack router/history, unrelated to this change). No new type errors introduced.

---

## Plane IDs (populated by /pp)

Phase A: AHR-1356

- Task 1: AHR-1357
- Task 2: AHR-1358
- Task 3: AHR-1359

Phase B: AHR-1360

- Task 1: AHR-1361
- Task 2: AHR-1362
- Task 3: AHR-1363
