# Employee list tab in department settings modal

Work Item: [AHR-683](https://plane.jimbui.dev/aiur/browse/AHR-683/)
Tier 1: [AHR-682] [v0.0.1 | Employee Management] Department employee management (Todo)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Employee records within an organization linked to departments via junction table. Admins manage department membership and manager roles. The department settings modal is the entry point for per-department configuration.
Tech: `App_DepartmentSettingsModal` (2 tabs: General, Danger Zone), `useQ_Tables_OrgEmployeesWithDepartments` (fetches employees with `rel__department__employee` join including `is_manager`), `peopleByDeptId` map (managers[] + employees[] per department), `useOrganization()` (provider context for organizationId)
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — entity/department hierarchy, department settings modal lives under organization components
Siblings: 3 total, 0 Done — AHR-683 Employee list tab (Not started), AHR-684 Add employee (Not started), AHR-685 Toggle manager (Not started)
Execution Order: Step 1 of 2 — no prerequisites (this IS the foundation)

## Phase A: Employees tab with list and search

- [x] In `App_DepartmentSettingsModal`, import `useOrganization` and `useQ_Tables_OrgEmployeesWithDepartments`. Call both hooks. Compute department employees from `peopleByDeptId[departmentId]` — combine managers and employees arrays into one sorted list
- [x] Add `useState<string>("")` for search term. Filter the department employees list by search term against `first_name`, `last_name`, and `email` (case-insensitive includes)
- [x] Add "Employees" tab item between General and Danger Zone. Tab content: `Input.Search` at the top for filtering, then employee rows. Each row shows `first_name last_name`, `email` as secondary text, and an ANTD `Tag` with "Manager" if `is_manager` is true for that department link
- [x] Add empty state — when department has no employees (after filtering or genuinely empty), show ANTD `Empty` component with description "No employees in this department"
- [x] Verify no prop changes needed on callers (`Page_Employees.tsx:484` and `Page_OrgChart.tsx:485`) — `useOrganization()` provides organizationId from provider context

---

## Plane IDs (populated by /pp)

Phase A: AHR-705

- Task 1: AHR-706
- Task 2: AHR-707
- Task 3: AHR-708
- Task 4: AHR-709
- Task 5: AHR-710
