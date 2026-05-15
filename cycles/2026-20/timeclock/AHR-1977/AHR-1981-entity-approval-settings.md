# Entity correction approval settings

> Version: [Outline](https://outline.jimbui.dev/doc/4af8ce40-4988-4719-a627-b1af569b4fee) | Tier 1: [AHR-1977](https://plane.jimbui.dev/aiur/browse/AHR-1977/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Admin can configure per-entity who must approve corrections: manager only, HR only, or both required
- Default approval mode: HR only
- Setting visible and editable in entity settings page
- Employees without a department assignment are backfilled to a default department (ensures manager chain always exists)
- Inline warning when approval mode requires managers but no department in the entity has a manager assigned
- "Manager only" → only the employee's department manager can approve
- "HR only" → only admin/owner can approve
- "Both" → correction needs approval from both manager AND HR before taking effect

## Scope boundaries

- Actual approval workflow logic (who can approve, approval UI) is AHR-1980 — this T2 only stores and exposes the setting
- Correction submission flow is AHR-1979 — this T2 does not touch submission UI
- No auto-assignment trigger for future employees — migration backfills existing unassigned employees; ongoing assignment is manual or handled by correction flow
- No default department reassignment UI — the migration marks the oldest department (or creates "General") as default; changing the default is not in scope

## Decisions

- **Decision:** Approval mode stored as column directly on `entities` table (not a separate entity_settings table)
  **Rationale:** Entities already has config columns (timezone, locale). One enum column is simpler, no join needed. YAGNI — only one setting exists.
- **Decision:** Default department identified via `is_default BOOLEAN` flag on `departments` with unique partial index (one per entity)
  **Rationale:** Explicit and queryable. Convention-based approaches (first by created_at, name match) are fragile. FK from entities→departments creates circular reference.
- **Decision:** Entity creation flow upgraded to 2-step: Step 1 (name + tz + locale), Step 2 (optional: add first department)
  **Rationale:** Guides admin to set up departments at entity creation time, reducing the chance of orphaned employees with no manager chain. Currently entity creation only captures name.

## Implementation

### Phase A — Schema migration

Single migration file: enum, column, is_default flag, backfill.

- [x] Create TYPE `entities_correction_approval_mode_enum` AS ENUM ('hr_only', 'manager_only', 'both')
- [x] ALTER TABLE entities ADD COLUMN `correction_approval_mode entities_correction_approval_mode_enum NOT NULL DEFAULT 'hr_only'`
- [x] ALTER TABLE departments ADD COLUMN `is_default BOOLEAN NOT NULL DEFAULT false`
- [x] CREATE UNIQUE INDEX `idx_departments_entity_default` ON departments(entity_id) WHERE is_default = true
- [x] Backfill: for entities with existing departments, mark the oldest (by created_at) as is_default = true
- [x] Backfill: for entities with no departments, INSERT a "General" department with is_default = true (trigger populates organization_id)
- [x] Backfill: INSERT INTO rel__department__employee for employees not in any department → assign to their entity's default department

### Phase B — Type regeneration + enum options

- [x] Run pnpm sb:dev:types to regenerate database.types.ts
- [x] Create `frontend/vite/src/hooks/const_EntitiesCorrectionApprovalModeOptions.ts` with hr_only/manager_only/both labels and descriptions

### Phase C — Entity settings modal: approval mode

Add correction approval mode Radio.Group to the General tab with contextual warning.

- [x] Update entity query in App_EntitySettingsModal to include `correction_approval_mode`
- [x] Add form field with Radio.Group: HR Only / Manager Only / Both (below locale field)
- [x] Query departments with is_manager flag: detect if any department in this entity has a manager
- [x] Show inline Alert (type="warning") when manager_only or both is selected but no manager exists in any department
- [x] Update UseM_EntitySettings_EntityUpdate_Body type to include correction_approval_mode
- [x] Add correction_approval_mode to form initialValues in useEffect

### Phase D — Entity creation flow: 2-step

Convert the Create Entity modal in Page_OrgChart from single-field to Steps-based.

- [x] Replace simple Form with ANTD Steps component (2 steps)
- [x] Step 1: Entity Name (required) + Timezone (optional) + Locale (optional)
- [x] Step 2: Department Name (optional, skippable with "Skip" button) — labeled as "(Optional)" next to step title
- [x] On finish: create entity first, then if department name provided, create department (with is_default = true)
- [x] Wire timezone/locale fields using const_TimezoneOptions (same pattern as entity settings modal)

### Phase E — Verification

- [x] Verify frontend compiles (npx tsc --noEmit)
- [x] Verify entity settings modal shows approval mode Radio and saves correctly
- [x] Verify inline warning appears when selecting manager_only/both with no managers
- [x] Verify entity creation 2-step flow works: create with and without optional department
- [x] Verify backfilled employees appear in their default department on org chart

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Admin settings for who approves employee time corrections per entity, plus default department safety net for manager approval chains.
Tech: Migration under frontend/vite/supabase/migrations/. Entity settings modal at components/organization/App_EntitySettingsModal.tsx. Entity creation modal inline in pages/Page_OrgChart/Page_OrgChart.tsx (lines 366-371). Mutation hook at hooks/useM_EntitySettings_EntityUpdate.ts. Departments table in 20260403134636_entities_departments.sql. Manager flag on rel__department__employee (20260413110002).
Related: [Timeclock](https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982) - correction approval requires entity-level config
Siblings: 4 total, 0 Done — [AHR-1978 Days + corrections schema (In Progress, 14/15 tasks), AHR-1979 Employee correction requests (Todo), AHR-1980 HR correction approval (Todo)]
Execution Order: Step 2 of 3 (parallel with AHR-1979) — prerequisite AHR-1978 nearly done (1 browser verification task remaining, all schema complete)
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
