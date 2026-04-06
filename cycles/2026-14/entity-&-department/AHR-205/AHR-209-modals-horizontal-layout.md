# Horizontal modal layout + entity/department settings modals

Work Item: [AHR-209](https://plane.jimbui.dev/aiur/browse/AHR-209/)
Tier 1: [AHR-205](https://plane.jimbui.dev/aiur/browse/AHR-205/) [v0.0.1 | Entity & Department] Entity & department management via org chart (In Progress)
Module: Entity & Department (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/93f24648-a9da-4b57-b51b-31db58d94a0f
Version Doc: https://outline.jimbui.dev/doc/0eb755a4-0002-428d-b119-09b772612683
Roadmap Feature: Entity Management (https://outline.jimbui.dev/doc/e7f99a59-2d14-4a9c-a66f-453cdc465524), Department Management (https://outline.jimbui.dev/doc/9e890394-bae6-4704-98d9-e291c9903726)

## Context (from spec)

Non-tech: All admin settings modals (org, entity, department) share a consistent layout: title on top with horizontal tabs below. Entity modal manages name/timezone/locale + entity employee assignments + delete. Department modal manages name + delete.
Tech: `components/organization/App_OrgSettingsModal.tsx` (migrate vertical tabs → horizontal + title header), new `App_EntitySettingsModal.tsx`, new `App_DepartmentSettingsModal.tsx`. New query/mutation hooks: `useQ_Tables_OrgEntities`, `useQ_Tables_EntityEmployees`, `useQ_Tables_EntityDepartments`, entity/department/entity-employee CRUD mutations. Tables: `entities`, `entity_employees`, `departments` (created in AHR-208). QueryKeys: add `entities`, `entityEmployees`, `departments`.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — OrgSettingsModal lives here, entity/dept modals follow same pattern
Siblings: 4 active, 0 Done — AHR-208 Schema (Done local), AHR-209 Modals (Todo), AHR-210 Chart view (Todo), AHR-211 List view (Todo)
Execution Order: Step 2 of 3 — AHR-208 done (local) ✓

## Phase A: QueryKeys + query/mutation hooks

- [x] Add `entities`, `entityEmployees`, `departments` to QueryKeys factory (`utils/query/queryKeys.ts`)
- [x] Create `useQ_Tables_OrgEntities` — list entities by organizationId
- [x] Create `useQ_Tables_EntityEmployees` — list entity_employees by entityId (join profiles for name/email)
- [x] Create `useQ_Tables_EntityDepartments` — list departments by entityId
- [x] Create `useM_EntitySettings_EntityCreate` — insert entity (name, timezone, locale, organization_id)
- [x] Create `useM_EntitySettings_EntityUpdate` — update entity fields (name, timezone, locale)
- [x] Create `useM_EntitySettings_EntityDelete` — delete entity by id
- [x] Create `useM_EntitySettings_EntityEmployeeAdd` — insert entity_employee (entity_id, user_id)
- [x] Create `useM_EntitySettings_EntityEmployeeRemove` — delete entity_employee by id
- [x] Create `useM_DeptSettings_DepartmentCreate` — insert department (name, entity_id, parent_id optional)
- [x] Create `useM_DeptSettings_DepartmentUpdate` — update department name
- [x] Create `useM_DeptSettings_DepartmentDelete` — delete department by id

## Phase B: OrgSettingsModal horizontal layout migration

- [x] Change `App_OrgSettingsModal` tabs from `tabPosition="left"` to horizontal (default top)
- [x] Add title header above tabs: org name displayed prominently
- [x] Verify existing Admins, General, Danger Zone tabs still work correctly

## Phase C: App_EntitySettingsModal

- [x] Create `App_EntitySettingsModal` component (`components/organization/App_EntitySettingsModal.tsx`) — props: open, onClose, entityId, entityName
- [x] Title header with entity name on top, horizontal tabs below
- [x] "General" tab: form with name (required), timezone (optional), locale (optional), save button using `useM_EntitySettings_EntityUpdate`
- [x] "Entity Employees" tab: list of assigned employees (from `useQ_Tables_EntityEmployees`), add employee dropdown (search org members), remove button per employee
- [x] "Danger Zone" tab: delete entity with name-confirmation, uses `useM_EntitySettings_EntityDelete`, blocked if entity has departments (check via `useQ_Tables_EntityDepartments`)

## Phase D: App_DepartmentSettingsModal

- [x] Create `App_DepartmentSettingsModal` component (`components/organization/App_DepartmentSettingsModal.tsx`) — props: open, onClose, departmentId, departmentName
- [x] Title header with department name on top, horizontal tabs below
- [x] "General" tab: form with name (required), save button using `useM_DeptSettings_DepartmentUpdate`
- [x] "Danger Zone" tab: delete department with name-confirmation, uses `useM_DeptSettings_DepartmentDelete`

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)
- Task 7: (pending)
- Task 8: (pending)
- Task 9: (pending)
- Task 10: (pending)
- Task 11: (pending)
- Task 12: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)

Phase C: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)

Phase D: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
