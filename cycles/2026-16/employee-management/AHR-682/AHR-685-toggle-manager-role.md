# Toggle department manager role

Work Item: [AHR-685](https://plane.jimbui.dev/aiur/browse/AHR-685/)
Tier 1: [AHR-682] [v0.0.1 | Employee Management] Department employee management (Todo)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Admins can promote or demote department members as managers directly from the department settings modal, via a three-dot menu on each employee row. The change is reflected immediately in the employee list and in org chart department cards.
Tech: `App_DepartmentSettingsModal` Employees tab (AHR-683 foundation), `useQ_Tables_OrgEmployeesWithDepartments` (provides `peopleByDeptId` + `managerIds` Set), `rel__department__employee.is_manager` (BOOLEAN, already added by migration `20260413110002_ahr643_rel_dept_emp_is_manager.sql`). New mutation hook UPDATEs the junction row by composite FK (`department_id` + `employee_id`).
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — department settings modal lives under organization components; org chart department card reads `people.managers` from the same query
Siblings: 3 total, 1 Done — AHR-683 Employee list tab (Done local, pending /pp), AHR-684 Add employee (Not started), AHR-685 Toggle manager (this)
Execution Order: Step 2 of 2 — prerequisite AHR-683 done ✓

## Phase A: Toggle manager mutation + UI

- [x] Create `src/hooks/useM_DeptSettings_$DeptEmployee$ManagerToggle.ts` — mutation hook taking `{ departmentId }` as params and `{ employeeId: string; is_manager: boolean }` as body. `mutationFn` runs `supabase.from("rel__department__employee").update({ is_manager }).eq("department_id", departmentId).eq("employee_id", employeeId)` using `sb_FromRelDepartmentEmployee_Update` naming. `onSuccess` invalidates `QueryKeys.departments.all()`. `onError` logs + `message.error("Failed to update manager role")`. `onSuccess` also calls `message.success` with "Promoted to manager" / "Removed as manager" based on body.is_manager
- [x] In `App_DepartmentSettingsModal.tsx`, import the new hook + `Dropdown` + `MoreOutlined` from ANTD. Instantiate `const mManagerToggle = useM_DeptSettings_$DeptEmployee$ManagerToggle({ departmentId })` alongside existing mutations
- [x] In the Employees tab `List.Item` renderItem, add an `actions={[...]}` slot containing a `Dropdown` with a `MoreOutlined` trigger button. `menu.items` is built inline: one item with `key: "toggle"`, `label: managerIds.has(emp.id) ? "Remove Manager" : "Make Manager"`, `onClick: () => mManagerToggle.mutation.mutate({ employeeId: emp.id, is_manager: !managerIds.has(emp.id) })`. Disable the button while `mManagerToggle.mutation.isPending`
- [x] Verify the list re-renders with updated Tag + menu label after toggle (visual check — query invalidation refetches `useQ_Tables_OrgEmployeesWithDepartments` which drives both)
- [x] Verify org chart department card managers section (`Page_Employees.tsx:226` — reads `people.managers`) updates after the toggle without page reload

---

## Plane IDs (populated by /pp)

Phase A: AHR-699

- Task 1: AHR-700
- Task 2: AHR-701
- Task 3: AHR-702
- Task 4: AHR-703
- Task 5: AHR-704
