# Entity-employee assignment

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1958](https://plane.jimbui.dev/aiur/browse/AHR-1958/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Admin assigns employee to entity → association persists
- Employee not assigned to any entity → cannot clock in (entity picker shows nothing)
- Removing entity assignment doesn't delete clock history
- Employees can query their own entity assignments (for clock-in entity picker)
- `rel__entity__employee` junction table with composite PK, CASCADE on both FKs, no `organization_id`

## Scope boundaries

- No `organization_id` on junction table — derives org access via entity FK (project convention for rel__ tables)
- No bulk assignment UI — single employee add/remove per action is sufficient for v0.0.2
- No entity auto-assignment during onboarding — that's a future onboarding enhancement
- Clock-in logic itself belongs to AHR-1962, not this T2 — we only build the data layer and assignment UI

## Decisions

- **Decision:** New `rel__entity__employee` table follows `rel__department__employee` pattern exactly
  **Rationale:** Composite PK, no id column, no org_id, CASCADE both FKs, indexes on both FK columns, `created_at` only
- **Decision:** RLS SELECT has two policies: admin/owner via entity subquery + employee self-access via `auth.uid()`
  **Rationale:** Admin manages assignments; employee needs to see own assignments for clock-in entity picker
- **Decision:** UI in entity settings modal ("Employees" tab) — not employee detail
  **Rationale:** Entity is the container for assignment; admin thinks "which employees work at this entity?"
- **Decision:** `useQ_Tables_MyEntityAssignments` built here for the clock-in entity picker (AHR-1962)
  **Rationale:** Foundation query — joins `rel__entity__employee` → `entities` for current user's employee record

## Implementation

### Phase A — Migration: rel__entity__employee + RLS + realtime

Create the junction table, RLS policies, and realtime trigger. Follows the exact pattern of `rel__department__employee` (migration `20260407051711`).

- [x] Create migration file `20260504113852_ahr1960_rel_entity_employee.sql`
- [x] `rel__entity__employee` table: composite PK `(entity_id, employee_id)`, CASCADE both FKs, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, indexes on both FK columns
- [x] RLS: admin/owner SELECT/INSERT/UPDATE/DELETE via `entity_id IN (SELECT id FROM entities WHERE is_admin_or_owner(organization_id))`
- [x] RLS: employee self-SELECT via `employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`
- [x] Add `rel__entity__employee` WHEN case to `notify_organization_of_table_change()` — 1-hop via `entity_id` to resolve `organization_id`
- [x] Create trigger `trg_notify_realtime_rel__entity__employee`
- [x] Run `pnpm sb:dev:types` to regenerate types
- [x] Add `rel__entity__employee` entry to `QueryKeys` factory in `queryKeys.ts`

### Phase B — Query + mutation hooks

Build the data-fetching and mutation hooks following project naming conventions.

- [x] `useQ_Tables_$Entity$Employee$Relation` — fetches employees for a given entity (admin view, for entity settings tab). Query: `supabase.from('rel__entity__employee').select('employee_id, created_at, employees(id, first_name, last_name, email, __full_name)').eq('entity_id', entityId)`
- [x] `useQ_Tables_MyEntityAssignments` — fetches entities for the current user's employee record (employee view, for clock-in picker). Query: `supabase.from('rel__entity__employee').select('entity_id, entities(id, name, timezone, organization_id)').eq('employee_id', myEmployeeId)`. Needs current employee ID from existing employee hooks
- [x] `useM_$Entity$Employee$RelationCreate` — assign employee to entity. Mutation: `supabase.from('rel__entity__employee').insert({ entity_id, employee_id })`. Invalidates both query keys
- [x] `useM_$Entity$Employee$RelationDelete` — unassign employee from entity. Mutation: `supabase.from('rel__entity__employee').delete().match({ entity_id, employee_id })`. Invalidates both query keys

### Phase C — Entity settings UI: "Employees" tab

Add an "Employees" tab to the existing `App_EntitySettingsModal` (currently has "General" and "Danger Zone" tabs).

- [x] Add "Employees" tab between "General" and "Danger Zone" in `App_EntitySettingsModal`
- [x] List assigned employees: avatar (initials), full name, email, department — using data from `useQ_Tables_$Entity$Employee$Relation`
- [x] "Add Employee" button: opens a Select dropdown searching org employees not yet assigned to this entity (filter out already-assigned). Uses `useQ_Tables_OrgEmployees` for the full list
- [x] Remove button per row with popconfirm: "Remove [name] from this entity?"
- [x] Empty state: "No employees assigned to this entity yet"
- [x] Loading/error states follow existing modal patterns

## Context

_Stripped at /pp push time._

Non-tech: Admins assign employees to business entities (offices/branches with their own timezone). This is the prerequisite for timeclock — employees can only clock in at entities they're assigned to.
Tech: Migration in `frontend/vite/supabase/migrations/`, hooks in `src/hooks/`, UI in `src/components/organization/App_EntitySettingsModal.tsx`. Pattern ref: `rel__department__employee` + `useQ_Tables_EntityDepartments`.
Related: [Timeclock](https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982) - entity assignment is foundation for clock-in entity picker
Siblings: 5 total, 0 Done — [AHR-1961 Nav restructure (Todo), AHR-1962 Clock strip (Todo), AHR-1963 My Timeclock (Todo), AHR-1964 HR Timesheets (Todo)]
Execution Order: Step 1 of 3 — no prerequisites, this IS the foundation
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
