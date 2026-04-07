# [v0.0.1 | Database] Schema audit remediation > Add FK on child organization_id columns

Work Item: [AHR-325](https://plane.jimbui.dev/aiur/browse/AHR-325/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (In Progress)
Module: [Database](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b
Version Doc: https://outline.jimbui.dev/doc/802df46d-8863-44ec-ae4f-d49cf5ff89cb

## Context (from spec)

Non-tech: Add missing foreign key constraint on departments.organization_id to enforce referential integrity with the organizations table.
Tech: `frontend/vite/supabase/migrations/20260403134636_entities_departments.sql` — departments table created with `organization_id text default '' not null` but no FK. Trigger `set_org_id_from_entity()` populates value. Need ALTER TABLE to add FK.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — departments are child of entities
Siblings: 6 total, 4 Done — [AHR-320 Drop currencies (Done), AHR-321 Drop RBAC (Done), AHR-322 Drop identifier (Done), AHR-323 Rename org_ tables (Done), AHR-324 Drop entity_employees + create junction (Todo), AHR-325 Add FK (Todo)]
Execution Order: Step 3 of 3 — all prerequisites done ✓

## Phase A: Add FK constraint migration

- [x] Create migration: validate no orphan organization_id values in departments, then ALTER TABLE ADD CONSTRAINT with REFERENCES organizations(id) ON DELETE CASCADE
- [x] Apply migration locally (db push --local), run db lint, regenerate types (pnpm sb:dev:types), verify TypeScript compiles

---

## Plane IDs (populated by /pp)

Phase A: AHR-390

- Task 1: AHR-391
- Task 2: AHR-392
