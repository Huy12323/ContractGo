# [v0.0.1 | Employee Management] Employee data model + onboarding forms > Create onboarding_forms table

Work Item: [AHR-399](https://plane.jimbui.dev/aiur/browse/AHR-399/)
Tier 1: [AHR-393] [v0.0.1 | Employee Management] Employee data model + onboarding forms (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Onboarding form templates that define which fields an employee fills during onboarding. Each form has a JSONB layout — a 2D array of rows × input keys (max 4 per row), referencing universal columns or dynamic codes.
Tech: CREATE TABLE public.onboarding_forms — top-level org table, generate_id('obf'), RLS admin-only. Pattern follows currencies migration.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — generate_id(), is_admin_or_owner()
Siblings: 4 total, 1 Done — [AHR-397 ALTER employees (Done), AHR-398 employee_columns (Not started), AHR-399 onboarding_forms (this item), AHR-400 form builder UI (Not started)]
Execution Order: Step 2 of 3 — Step 1 AHR-397 done ✓

## Phase A: Schema migration + type regeneration

- [x] Create migration file: CREATE TABLE onboarding_forms (id TEXT PK generate_id('obf'), organization_id TEXT NOT NULL FK, name TEXT NOT NULL, layout JSONB NOT NULL DEFAULT '{}', created_at, updated_at) + UNIQUE(organization_id, name) + index + RLS with is_admin_or_owner for all 4 policies (SELECT/INSERT/UPDATE/DELETE)
- [x] Apply migration locally (supabase db push --local)
- [x] Run database lint (supabase db lint --local)
- [x] Regenerate TypeScript types (pnpm sb:dev:types)
- [x] Verify TypeScript compilation passes (pnpm tsc --noEmit)

---

## Plane IDs (populated by /pp)

Phase A: AHR-458

- Task 1: AHR-459
- Task 2: AHR-460
- Task 3: AHR-461
- Task 4: AHR-462
- Task 5: AHR-463
