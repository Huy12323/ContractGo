# [v0.0.1 | Organization] Entity + department schema enhancements > Add is_manager to rel__department__employee

Work Item: [AHR-643](https://plane.jimbui.dev/aiur/browse/AHR-643/)
Tier 1: [AHR-642] [v0.0.1 | Organization] Entity + department schema enhancements (Backlog)
Module: [Organization](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/91312a3a-9fbf-43d7-9f32-eadab41aab8a

## Context (from spec)

Non-tech: A department can have zero, one, or many managers. The `is_manager` flag on the employee-department junction enables the org chart to split "Managers" from "Employees" in the department card collapsible sections.
Tech: `rel__department__employee` table — currently has `(department_id, employee_id)` only (no organization_id per junction convention). Add `is_manager BOOLEAN NOT NULL DEFAULT false`. No RLS changes (the flag doesn't affect access control). Existing rows default to false.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — the org chart card UI (AHR-639/641) will consume this flag to render separate Managers/Employees collapsible sections.
Siblings: 2 total, 0 Done — [AHR-643 is_manager (Todo) ←, AHR-644 Timezone enum (Todo)]
Execution Order: Step 1 of 1 — parallel with AHR-644, no prerequisites

## Phase A: Migration + types

- [x] Create `frontend/vite/supabase/migrations/20260413110002_ahr643_rel_dept_emp_is_manager.sql` — `ALTER TABLE public.rel__department__employee ADD COLUMN is_manager BOOLEAN NOT NULL DEFAULT false;`
- [x] Applied locally, types regenerated — `is_manager: boolean` confirmed in `rel__department__employee.Row`.

---

## Plane IDs (populated by /pp)

Phase A: AHR-645

- Task 1: AHR-646
- Task 2: AHR-647
