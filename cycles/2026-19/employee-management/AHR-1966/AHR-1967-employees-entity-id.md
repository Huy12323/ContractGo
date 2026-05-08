# Employees table entity_id + backfill

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1966](https://plane.jimbui.dev/aiur/browse/AHR-1966/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `employees` table gets `entity_id TEXT NOT NULL` FK to `entities(id) ON DELETE CASCADE`
- Unique constraint changes from `(organization_id, user_id)` to `(entity_id, user_id)`
- `organization_id` becomes trigger-populated from entity (child table pattern)
- All existing employees backfilled with an entity_id (first entity in their org, or a newly created default entity)
- `rel__entity__employee` table dropped — redundant
- All FE hooks and UI referencing `rel__entity__employee` removed
- Types regenerated, QueryKeys updated

## Scope boundaries

- Edge function `approve-contract` update belongs to AHR-1969 — new onboardings will fail (NOT NULL violation) until then. This is expected.
- Dynamic columns migration (`org_<id>__employees` → `ent_<id>__employees`) belongs to AHR-1968
- No new UI features — this is pure schema migration + FE cleanup

## Decisions

- **Decision:** `entity_id` is NOT NULL immediately after backfill
  **Rationale:** Nullable defeats the model. Edge function breakage for new onboardings is accepted — AHR-1969 is the immediate next step.
- **Decision:** Backfill uses org's first entity by `created_at`; create default entity (named after org) for orgs with employees but no entities
  **Rationale:** Deterministic, simple. Admin can rename/reassign later.
- **Decision:** `organization_id` stays on `employees` but becomes trigger-populated via `set_org_id_from_entity()`
  **Rationale:** RLS still needs it for single-hop org checks. Reuses existing trigger function. DEFAULT changes to `''` for Supabase type gen (child table pattern).
- **Decision:** Existing RLS policies unchanged — they use `organization_id` which still exists
  **Rationale:** No behavioral change to access control. The org_id is just populated differently (trigger vs explicit).

## Implementation

### Phase A — Migration SQL

Single migration file handling the full schema change: add column, backfill, constraints, trigger, drop redundant table.

- [x] Create migration file `YYYYMMDDHHMMSS_ahr1967_employees_entity_id.sql`
- [x] Create default entities for orgs that have employees but no entities: `INSERT INTO entities (organization_id, name) SELECT DISTINCT e.organization_id, o.name FROM employees e JOIN organizations o ON e.organization_id = o.id WHERE e.organization_id NOT IN (SELECT organization_id FROM entities)`
- [x] Add `entity_id TEXT` column (nullable initially) with FK to `entities(id) ON DELETE CASCADE`
- [x] Add index `idx_employees_entity_id`
- [x] Backfill: `UPDATE employees SET entity_id = (SELECT id FROM entities WHERE organization_id = employees.organization_id ORDER BY created_at ASC LIMIT 1)`
- [x] `ALTER COLUMN entity_id SET NOT NULL`
- [x] Drop old unique constraint: `ALTER TABLE employees DROP CONSTRAINT org_employees_organization_id_user_id_key`
- [x] Add new unique constraint: `ALTER TABLE employees ADD CONSTRAINT employees_entity_id_user_id_key UNIQUE (entity_id, user_id)`
- [x] Change `organization_id` default to `''` for child table pattern: `ALTER COLUMN organization_id SET DEFAULT ''`
- [x] Create BEFORE INSERT trigger: `CREATE TRIGGER trigger_set_org_id_employees BEFORE INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_entity()`
- [x] Drop `rel__entity__employee` table: `DROP TABLE public.rel__entity__employee CASCADE`
- [x] Update `get_organization_id_for_change()` — remove the `rel__entity__employee` WHEN case

### Phase B — FE cleanup: types, hooks, QueryKeys, UI

Remove all `rel__entity__employee` artifacts and update employee queries to include entity data.

- [x] Run `pnpm sb:dev:types` to regenerate types
- [x] Remove `rel__entity__employee` from `QueryKeys` in `queryKeys.ts`
- [x] Delete `src/hooks/useQ_Tables_$Entity$Employee$Relation.ts`
- [x] Delete `src/hooks/useQ_Tables_MyEntityAssignments.ts`
- [x] Delete `src/hooks/useM_$Entity$Employee$RelationCreate.ts`
- [x] Delete `src/hooks/useM_$Entity$Employee$RelationDelete.ts`
- [x] Revert `App_EntitySettingsModal.tsx` — remove Employees tab, restore to General + Danger Zone only (remove all rel__entity__employee imports and code)
- [x] Update `useQ_Tables_OrgEmployees` — add entity join: `employees(*, entities(id, name, timezone))` so grid can show entity column
- [x] Verify `tsc --noEmit` passes

## Context

_Stripped at /pp push time._

Non-tech: Migrating the employees table to be entity-scoped — each employee record belongs to a specific business entity (office/branch). Same person can have separate employment records at different entities with different names, contracts, and policies.
Tech: Migration in `frontend/vite/supabase/migrations/`. Key constraint: `org_employees_organization_id_user_id_key` (original table name). Trigger function `set_org_id_from_entity()` already exists. FK dependents: `rel__department__employee`, `employee_contracts`, `org_<id>__employees`. Edge function `employee-onboarding_approve-contract/index.ts` line 287 inserts employees — will break until AHR-1969.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) - core employee schema
Siblings: 3 total, 0 Done — [AHR-1968 Dynamic columns migration (Todo), AHR-1969 Onboarding entity selection (Todo)]
Execution Order: Step 1 of 2 — no prerequisites, this IS the foundation
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
