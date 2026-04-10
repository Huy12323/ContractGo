# [v0.0.1 | Employee Management] Employee data model + onboarding forms > ALTER employees table — add universal columns

Work Item: [AHR-397](https://plane.jimbui.dev/aiur/browse/AHR-397/)
Tier 1: [AHR-393] [v0.0.1 | Employee Management] Employee data model + onboarding forms (Todo)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Add universal employee fields (email, name, birthday) to the employees table so every employee record has baseline data before custom columns are layered on.
Tech: ALTER TABLE public.employees — currently has id, organization_id, user_id, created_at. Migration adds 5 columns. Regenerate database.types.ts.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — base schema, generate_id()
Siblings: 4 total, 0 Done — [AHR-397 ALTER employees (Todo), AHR-398 employee_columns table (Todo), AHR-399 onboarding_forms table (Todo), AHR-400 form builder UI (Todo)]
Execution Order: Step 1 of 3 — no prerequisites, this is the foundation

## Phase A: Schema migration + type regeneration

- [x] Create migration file: ALTER TABLE employees ADD COLUMN email (text NOT NULL DEFAULT ''), first_name (text NOT NULL DEFAULT ''), last_name (text NOT NULL DEFAULT ''), birthday (date), updated_at (timestamptz DEFAULT now())
- [x] Apply migration locally (supabase db push --local)
- [x] Regenerate TypeScript types (pnpm sb:dev:types)
- [x] Verify TypeScript compilation passes (pnpm tsc --noEmit)

---

## Plane IDs (populated by /pp)

Phase A: AHR-406

- Task 1: AHR-407
- Task 2: AHR-408
- Task 3: AHR-409
- Task 4: AHR-410
