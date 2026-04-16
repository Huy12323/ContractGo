# Create employee_views table

Work Item: [AHR-404](https://plane.jimbui.dev/aiur/browse/AHR-404/)
Tier 1: [AHR-396] [v0.0.1 | Employee Management] Employees page — saved views (Todo)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Saved views let HR curate filter/sort/column layouts for the employees table so all org members can pick from a shared library of views. AHR-404 is the data foundation — the table and RLS — before any UI lands in AHR-405.
Tech: New `employee_views` table (top-level, direct `organization_id`), JSONB `config` column holding columnOrder/hiddenKeys/sortEntries/filterNodes/groupByKeys. RLS split: SELECT via `is_org_member`, CUD via `is_admin_or_owner` (project-specific helpers, see `ext-supabase-rls-policies`). No type override for `config` in this T2 — deferred to AHR-405.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org context + is_admin_or_owner helper definition
Siblings: 2 total, 0 Done — AHR-404 Create employee_views table (this, In Progress after /p), AHR-405 Saved views UI (Not started)
Execution Order: Step 1 of 2 — foundation, no prerequisites

## Phase A: Migration

- [x] Create `frontend/vite/supabase/migrations/YYYYMMDDHHMMSS_ahr404_create_employee_views.sql`. Schema: `id TEXT PK DEFAULT generate_id('evw')`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL`, `name TEXT NOT NULL`, `config JSONB NOT NULL DEFAULT '{}'`, `is_default BOOLEAN NOT NULL DEFAULT false`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`. Index on `organization_id`
- [x] Add four RLS policies in the same migration: `org_members_can_view_employee_views` (SELECT via `is_org_member(organization_id)`), `admin_or_owner_can_insert_employee_views`, `admin_or_owner_can_update_employee_views`, `admin_or_owner_can_delete_employee_views` (CUD via `is_admin_or_owner(organization_id)`)
- [x] Apply migration locally (`pnpm sb:local:push` preserving data), run `supabase db lint --local` to check for perf warnings, regenerate types (`pnpm sb:dev:types`). Verify `employee_views` appears in `frontend/vite/src/types/database.types.ts` with `config: Json`

---

## Plane IDs (populated by /pp)

Phase A: AHR-793

- Task 1 (Create migration file): AHR-794
- Task 2 (Add 4 RLS policies): AHR-795
- Task 3 (Apply + lint + regen types): AHR-796
