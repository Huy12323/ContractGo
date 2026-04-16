# Contract approval refreshes department cache

Work Item: [AHR-687](https://plane.jimbui.dev/aiur/browse/AHR-687/)
Tier 1: [AHR-686] [v0.0.1 | Employee Onboarding] Onboarding UX fixes: approval cache + invitee error (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: After HR approves a contract, the new employee row + department junction rows are created server-side, but the org chart department cards and the Employees tab in the department settings modal stay stale until the user reloads. This T2 wires the missing cache invalidation so the views refresh automatically.
Tech: `useM_OnboardingInvitation_Approve.ts` (`onSuccess` invalidations — was missing `departments`), `useQ_Tables_OrgEmployeesWithDepartments` (keyed under `QueryKeys.departments.list()`, so invalidating `departments.all()` refetches it), `App_DepartmentSettingsModal.tsx` Employees tab + `Page_Employees.tsx` org chart cards (consumers of the stale data).
Related: Employee Management (https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — owns the employees + department views that go stale; this fix lives in onboarding code but its symptom surfaces there.
Siblings: 2 total, 1 Done — AHR-688 Invitee error UX (Done), AHR-687 (this)
Execution Order: Step 1 of 2 — no prerequisites (foundation; ran in parallel with AHR-688 in practice)

## Phase A: Cache invalidation

- [x] In `useM_OnboardingInvitation_Approve.ts`, add `queryClient.invalidateQueries({ queryKey: QueryKeys.departments.all() })` to the `onSuccess` callback alongside the existing `onboardingInvitations.all()` and `contracts.all()` invalidations. `useQ_Tables_OrgEmployeesWithDepartments` is keyed under `departments.list()`, so this single invalidation refreshes both the org chart managers section and the department settings modal Employees tab.

---

## Plane IDs (populated by /pp)

Phase A: AHR-697

- Task 1: AHR-698
