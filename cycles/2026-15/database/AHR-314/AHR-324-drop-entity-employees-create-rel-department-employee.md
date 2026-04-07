# Drop entity_employees, create rel__department__employee

Work Item: [AHR-324](https://plane.jimbui.dev/aiur/browse/AHR-324/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (In Progress)
Module: Database (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b
Version Doc: https://outline.jimbui.dev/doc/802df46d-8863-44ec-ae4f-d49cf5ff89cb

## Context (from spec)

Non-tech: The entity-employee relationship table (`entity_employees`) is being replaced by a proper department-employee junction table following Bible conventions (composite PK, no surrogate id). The old table used a surrogate `id`, wrong naming, and linked entities to profiles instead of departments to employees.
Tech: Migration drops `entity_employees` (trigger, RLS, indexes cascade), creates `rel__department__employee` with composite PK, trigger-populated `organization_id` from `departments`. Frontend: delete 3 hooks (`useQ_Tables_EntityEmployees`, `useM_EntitySettings_EntityEmployeeAdd`, `useM_EntitySettings_EntityEmployeeRemove`), remove `entityEmployees` from `queryKeys.ts`, clean up `App_EntitySettingsModal.tsx`.
Related: Employee Management (https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) - future department-employee UI will consume the new junction table
Siblings: 6 total, 4 Done — [AHR-320 Drop currencies (Done), AHR-321 Drop RBAC (Done), AHR-322 Drop identifier (Done), AHR-323 Rename org_ tables (Done), AHR-324 Drop entity_employees (Todo) ←, AHR-325 Add child FK (Todo)]
Execution Order: Step 3 of 3 — all prerequisites done ✓ (AHR-320+321+322 step 1, AHR-323 step 2)

## Phase A: Database migration

Single migration file: `YYYYMMDDHHMMSS_drop_entity_employees_create_rel_department_employee.sql`

- [x] `DROP TABLE public.entity_employees CASCADE` (drops trigger, RLS policies, indexes, unique constraint)
- [x] Create `rel__department__employee` with: composite PK `(department_id, employee_id)`, `department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE`, `employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE`, `organization_id TEXT DEFAULT '' NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, indexes on `department_id`, `employee_id`, and `organization_id`
- [x] Create `set_org_id_from_department()` trigger function (SECURITY DEFINER, search_path = public) + BEFORE INSERT trigger `trigger_set_org_id_rel__department__employee` to populate organization_id from department
- [x] Enable RLS with 4 `is_admin_or_owner` policies: `admin_or_owner_can_view_rel__department__employee` (SELECT), `admin_or_owner_can_insert_rel__department__employee` (INSERT), `admin_or_owner_can_update_rel__department__employee` (UPDATE), `admin_or_owner_can_delete_rel__department__employee` (DELETE)
- [x] Apply migration: `supabase db push --local`, then `supabase db lint --local`

## Phase B: Frontend cleanup

- [x] Delete 3 hook files: `useQ_Tables_EntityEmployees.ts`, `useM_EntitySettings_EntityEmployeeAdd.ts`, `useM_EntitySettings_EntityEmployeeRemove.ts`
- [x] Remove `entityEmployees` entry from `queryKeys.ts`
- [x] Remove "Entity Employees" tab from `App_EntitySettingsModal.tsx` — delete the tab, remove the 3 hook imports, remove `selectedUserId` state and `assignedUserIds`/`availableMembers` computed values, remove `useQ_Tables_Admins` import (only used for employee filtering). Keep General + Danger Zone tabs.

## Phase C: Type regeneration & verification

- [x] Regenerate types: `pnpm sb:dev:types`
- [x] Verify TypeScript compiles

---

## Plane IDs (populated by /pp)

Phase A: AHR-379

- Task 1: AHR-380
- Task 2: AHR-381
- Task 3: AHR-382

Phase B: AHR-383

- Task 1: AHR-384
- Task 2: AHR-385
- Task 3: AHR-386

Phase C: AHR-387

- Task 1: AHR-388
- Task 2: AHR-389
