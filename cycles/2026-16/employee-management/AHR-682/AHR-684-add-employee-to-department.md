# Add employee to department

Work Item: [AHR-684](https://plane.jimbui.dev/aiur/browse/AHR-684/)
Tier 1: [AHR-682] [v0.0.1 | Employee Management] Department employee management (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Department membership is managed by admins from the department settings modal. Employees can be added to a department by picking from the pool of org employees not already assigned.
Tech: `App_DepartmentSettingsModal` (Employees tab from AHR-683), `rel__department__employee` (composite PK: department_id + employee_id, is_manager defaults false), `useQ_Tables_OrgEmployeesWithDepartments` (source of both assigned and all-org employees), `QueryKeys.departments.list()` (cache key to invalidate)
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — department hierarchy and settings modal home
Siblings: 3 total, 1 Done (local) — AHR-683 Employee list tab (Done local, pending /pp), AHR-684 Add employee (this, In Progress), AHR-685 Toggle manager (Not started)
Execution Order: Step 2 of 2 — prerequisite AHR-683 effectively Done ✓

## Phase A: Mutation hook

- [x] Create `src/hooks/useM_DeptSettings_$Department$Employee$RelationCreate.ts` — accepts `{ departmentId }` as hook param, `{ employee_id }` as mutation body. Inserts into `rel__department__employee` with `is_manager: false`. Invalidates `QueryKeys.departments.all()` on success (matches the `useQ_Tables_OrgEmployeesWithDepartments` composite query key). Use `App.useApp()` for success/error messages

## Phase B: Add Employee UI in modal

- [x] In `App_DepartmentSettingsModal`, compute `availableEmployees` as `useMemo` — all employees from `qEmployees.employees` minus those already in this department (use Set of `deptEmployees` ids for O(1) exclusion). Map to `{ label: "FirstName LastName — email", value: employee.id }` options
- [x] Add `useM_DeptSettings_$Department$Employee$RelationCreate` hook call. Add an ANTD `Select` component next to `Input.Search` in a flex row. `Select` props: `showSearch`, `placeholder="Add Employee"`, `value={null}` (stays clearable), `filterOption` matches label (case-insensitive), `onSelect` fires `mutation.mutate({ employee_id: value })`. After successful mutation, the invalidation auto-refreshes `deptEmployees`

## Phase C: Remove action + styling polish (scope additions)

- [x] Create `useM_DeptSettings_$Department$Employee$RelationDelete` hook — DELETE on composite PK (department_id + employee_id). Invalidates `QueryKeys.departments.all()` on success. User-requested mid-session addition
- [x] Add "Remove from department" danger item to the Dropdown menu in the Employees tab (below the Make/Remove Manager toggle, with divider)
- [x] Replace `Input.Search` with plain `Input` + `SearchOutlined` prefix to eliminate the inner button height mismatch. Add `Select: { controlHeight: 40, borderRadius: 32 }` to `Provider_ANTD.tsx` so `Select` matches `Input` pill styling app-wide
- [x] List polish — `Avatar` with first-letter initial (blue for managers, gray otherwise), `Typography.Text` for name/email, blue bordered-less Manager tag, card-style rows with subtle border + hover state via inline `<style>` tag

---

## Plane IDs (populated by /pp)

Phase A: AHR-712

- Task 1: AHR-713

Phase B: AHR-714

- Task 1: AHR-715
- Task 2: AHR-716

Phase C: AHR-717

- Task 1: AHR-718
- Task 2: AHR-719
- Task 3: AHR-720
- Task 4: AHR-721
