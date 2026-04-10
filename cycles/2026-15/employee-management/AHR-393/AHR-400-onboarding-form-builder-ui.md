# [v0.0.1 | Employee Management] Employee data model + onboarding forms > Onboarding form builder UI

Work Item: [AHR-400](https://plane.jimbui.dev/aiur/browse/AHR-400/)
Tier 1: [AHR-393] [v0.0.1 | Employee Management] Employee data model + onboarding forms (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Admin-facing form builder for designing onboarding forms. Each form defines which fields an employee fills during onboarding, using a 2D row × field layout. Hosted on the renamed Employees page and accessible from org settings.
Tech: Page_Employees (rename from Page_OrgChart), route change, App_OrgSettingsModal tab, query/mutation hooks for onboarding_forms + employee_columns tables, edge function call for field creation.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — generate_id(), RLS helpers. [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — App_OrgSettingsModal
Siblings: 4 total, 3 Done — [AHR-397 ALTER employees (Done), AHR-398 employee_columns + edge fn (Done, local), AHR-399 onboarding_forms table (Done, local), AHR-400 form builder UI (this item)]
Execution Order: Step 3 of 3 — Steps 1+2 all done ✓

## Phase A: Page rename + route + horizontal bar

- [x] Rename `Page_OrgChart/` → `Page_Employees/`, update component name and all references
- [x] Move route file from `$organizationId/org-chart/` to `$organizationId/employees/`, update `createFileRoute` path
- [x] Update sidebar nav in `App_VerticalNav.tsx`: icon, label "Employees", link to `/employees`
- [x] Add horizontal bar inside Page_Employees: "Employees" title (left), Segmented view switcher (Chart | List) + "View Forms" Button + "Onboard Employee" Button disabled (right)
- [x] Existing org chart content renders under Chart mode, List mode shows empty placeholder

## Phase B: Onboarding forms list + CRUD

- [x] Add `onboardingForms` and `employeeColumns` entries to QueryKeys
- [x] Create `useQ_Tables_OnboardingForms` query hook (fetch all forms for org)
- [x] Create mutations: `useM_OnboardingFormCreate`, `useM_OnboardingFormUpdate`, `useM_OnboardingFormDelete`
- [x] Create `App_OnboardingFormsList` component (reusable card-based list: form name, created date, edit/delete actions, "Create new form" button)
- [x] Create `App_ViewFormsModal` (standalone modal wrapping `App_OnboardingFormsList`)
- [x] Wire "View Forms" button in Page_Employees → opens `App_ViewFormsModal`
- [x] Add "Onboarding Forms" tab to `App_OrgSettingsModal` reusing `App_OnboardingFormsList`

## Phase C+D: MIGRATED → AHR-415 (Employee field management)

Phases C (employee_column_choices table) and D (Field Manager Modal) were migrated to a separate T1:
- AHR-419: employee_column_choices table + edge function update (Done)
- AHR-421: Field Manager Modal + CRUD (Done)
- AHR-422: employee_columns DELETE policy (Done)

## Phase E: DnD form builder (REWORK)

- [x] Install `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`
- [x] Rewrite `App_FormBuilderModal` as two-column DnD layout: left = available fields list, right = form layout grid
- [x] Left column: all universal + dynamic fields, each with 6-dot drag handle (GripVertical). Fields already in the form are grayed/disabled
- [x] Right column: rows rendered as dashed-outline drop zones. Empty state shows a single empty drop zone placeholder
- [x] DnD: dragging a field from left to an empty drop zone creates a new row. Dragging to an existing row inserts at the highlighted gap (existing fields shift/shrink to show drop indicator). Max 4 fields per row enforced
- [x] DnD within right column: reorder fields within a row, move between rows, reorder rows themselves
- [x] Remove field: click X on the field chip (removes from form, re-enables in palette)
- [x] Form name input at top, save button serializes to JSONB 2D array
- [x] Preview toggle (Segmented: edit/eye icons) — renders form as employee sees it
- [x] Remove old button-based interaction code (arrows, dropdown pickers, inline + buttons)

---

## Plane IDs (populated by /pp)

Phase A: AHR-433

- Task 1: AHR-434
- Task 2: AHR-435
- Task 3: AHR-436
- Task 4: AHR-437
- Task 5: AHR-438

Phase B: AHR-439

- Task 1: AHR-440
- Task 2: AHR-441
- Task 3: AHR-442
- Task 4: AHR-443
- Task 5: AHR-444
- Task 6: AHR-445
- Task 7: AHR-446

Phase C+D: MIGRATED → AHR-415

Phase E: AHR-447

- Task 1: AHR-448
- Task 2: AHR-449
- Task 3: AHR-450
- Task 4: AHR-451
- Task 5: AHR-452
- Task 6: AHR-453
- Task 7: AHR-454
- Task 8: AHR-455
- Task 9: AHR-456
- Task 10: AHR-457
