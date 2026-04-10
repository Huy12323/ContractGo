# [v0.0.1 | Employee Management] Employee data model + onboarding forms > Create employee_columns table + ENUM + edge function

Work Item: [AHR-398](https://plane.jimbui.dev/aiur/browse/AHR-398/)
Tier 1: [AHR-393] [v0.0.1 | Employee Management] Employee data model + onboarding forms (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Dynamic custom columns per organization — admins define column metadata (label, type, options), and an edge function creates actual PostgreSQL columns on the employees table at runtime.
Tech: New ENUM `employee_column_type`, new table `employee_columns` (top-level, organization_id FK), edge function `employee-management_create-column` using service_role for ALTER TABLE. PG type mapping: text→text, number→numeric, date→date, boolean→boolean, multi_select→text[]. Column names use quoted `generate_id('col')` identifiers.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — base schema, generate_id(), RLS helpers
Siblings: 4 total, 1 Done — [AHR-397 ALTER employees (Done), AHR-398 employee_columns (Not started), AHR-399 onboarding_forms (Not started), AHR-400 form builder UI (Not started)]
Execution Order: Step 2 of 3 — all done ✓ (AHR-397 Done)

## Phase A: Schema migration — ENUM + table + RLS

- [x] Create migration file with: (1) `employee_column_type` ENUM (text, number, date, boolean, multi_select), (2) `employee_columns` table — id TEXT PK DEFAULT generate_id('col'), organization_id TEXT NOT NULL FK → organizations, label TEXT NOT NULL, type employee_column_type NOT NULL, options JSONB, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), (3) index on organization_id, (4) RLS enabled with 4 policies: SELECT → is_org_member, INSERT → is_admin_or_owner, UPDATE → is_admin_or_owner, no DELETE policy
- [x] Apply migration locally (supabase db push --local)
- [x] Run db lint (supabase db lint --local)
- [x] Regenerate TypeScript types (pnpm sb:dev:types)
- [x] Create const_EmployeeColumnsTypeOptions enum options file

## Phase B: Edge function — create column + ALTER TABLE

- [x] Create edge function directory `employee-management_create-column/` with deno.json (supabase import map)
- [x] Create index.ts: authenticate caller via auth header, verify admin/owner role by querying admins table, accept JSON body {label, type, options?}, INSERT into employee_columns via service_role client, retrieve generated id, map type to PG type (text→text, number→numeric, date→date, boolean→boolean, multi_select→text[]), execute ALTER TABLE employees ADD COLUMN "{id}" {pg_type} via RPC (add_employee_column), return created column record. Includes rollback on ALTER failure.
- [x] Verify edge function locally (supabase functions serve + manual curl test)

---

## Plane IDs (populated by /pp)

Phase A: AHR-411

- Task 1: AHR-412
- Task 2: AHR-413
- Task 3: AHR-414
- Task 4: AHR-416

Phase B: AHR-417

- Task 1: AHR-418
- Task 2: AHR-420
