# HR correction approval

> Version: [Outline](https://outline.jimbui.dev/doc/4af8ce40-4988-4719-a627-b1af569b4fee) | Tier 1: [AHR-1977](https://plane.jimbui.dev/aiur/browse/AHR-1977/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- HR/manager sees a list of pending correction requests across employees
- Can review requested time entries alongside the original sessions for that day
- Can approve or reject with an optional response message
- Approved corrections immediately reflected in timesheet data (My Timeclock + HR Timesheets grid)
- Rejected corrections show the rejection reason to the employee in their corrections list
- When entity requires both manager + HR approval, correction stays pending until both approve

## Scope boundaries

- Entity approval mode setting is AHR-1981 — this T2 implements the approval workflow that consumes it
- Correction submission flow is AHR-1979 — this T2 adds department selection to submission and builds the review/approval UI
- Days + corrections schema is AHR-1978 — this T2 extends it with junction tables, decision tracking, and realtime

## Decisions

- **Decision:** Multi-department approval via `rel__correction_task__department` junction table with per-department decision tracking (decision enum, decided_by, decided_at)
  **Rationale:** Each department manager approves independently. Junction table cleanly separates department-level decisions from the overall task status. Admin decision tracked separately on correction_tasks (admin_decision, admin_decided_by, admin_decided_at).
- **Decision:** `approve_correction_task` RPC as SECURITY DEFINER handles all approval business logic server-side
  **Rationale:** Complex multi-step logic (check role, update dept decision, check all depts, transition status) must be atomic. Client-side orchestration would be fragile and bypassable.
- **Decision:** RLS recursion between correction_tasks ↔ rel__correction_task__department solved with `get_my_department_ids()` and `get_managed_correction_task_ids()` SECURITY DEFINER helper functions
  **Rationale:** Direct RLS policies on junction tables that reference each other's parent create infinite recursion. Helper functions break the cycle.
- **Decision:** Sidebar restructured — Apps is a group label, Tasks is a direct nav item (not a hub page)
  **Rationale:** User feedback — the hub page was unnecessary indirection. Tasks is the first and currently only app.
- **Decision:** Entity selector supports `scope: "organization" | "employee"` — employee pages (My Timeclock) show only entities where user has an employee record, even if they're HR
  **Rationale:** My Timeclock is personal — HR shouldn't see entities they aren't employed in. Admin pages (Timesheets, Tasks) use org scope.
- **Decision:** Managers can see and approve their own corrections IF submitted to a department they manage. They cannot see their own corrections submitted to departments they don't manage.
  **Rationale:** Self-approval to own managed department is intentional. Employee self-read RLS would otherwise show corrections in Tasks that the manager has no authority over.
- **Decision:** Timesheet grid RPC uses `DISTINCT ON (employee_id, day_id) ORDER BY admin_decided_at DESC` to select only the latest approved correction per employee+day
  **Rationale:** Multiple approved corrections on the same day caused overcounting when all correction rows were unioned together.

Original Estimate: 3 points

## Implementation

### Phase A — Database: approval infrastructure

9 migration files for multi-department approval, RLS, realtime, decision tracking.

- [x] Add `manager_approved` to correction_task_status_enum
- [x] Create `rel__correction_task__department` junction table with RLS (admin CRUD, manager view/update, employee view/insert)
- [x] Create `approve_correction_task` RPC (SECURITY DEFINER) with hr_only, manager_only, both mode logic
- [x] Fix RLS recursion with `get_my_department_ids()` and `get_managed_correction_task_ids()` SECURITY DEFINER helpers
- [x] Add employee self-read policies on entities, departments, rel__department__employee
- [x] Add org-wide department read via `is_org_member(organization_id)`
- [x] Extend realtime org-id resolver for correction_tasks, timeclock_corrections, rel__correction_task__department
- [x] Add no-department fallback to approve RPC (HR can approve old corrections without dept junctions)
- [x] Add per-department decision columns (correction_dept_decision_enum: approved/rejected, decided_by, decided_at)
- [x] Add admin decision columns (correction_admin_decision_enum: approved/rejected, admin_decided_by, admin_decided_at)
- [x] Fix get_timesheet_grid RPC: DISTINCT ON latest approved correction per employee+day, per-day session exclusion

### Phase B — Frontend: Apps/Tasks page

New page hierarchy for correction approval queue.

- [x] Restructure sidebar: Apps as group label, Tasks as direct nav item with CheckSquareOutlined icon
- [x] Create PageApps_Tasks with entity selector toolbar, Tabs navigation, role-based tab visibility
- [x] Create PageApps_Tasks_CorrectionsTab with Actionable/All filter, corrections grid, department approval tags, admin decision column
- [x] Create PageApps_Tasks_CorrectionReviewModal with before/after bars, side-by-side timelines, department progress tags, approve/reject buttons
- [x] Create useQ_PageApps_EntityCorrectionTasks query hook
- [x] Create useQ_PageApps_MyManagerDepartments query hook
- [x] Create useM_PageApps_CorrectionTaskApprove mutation hook
- [x] Create useM_PageApps_CorrectionTaskReject mutation hook
- [x] Manager self-correction filter (hide own corrections unless linked to managed department)
- [x] Scrollbar inside table rows only (sticky filter + header)

### Phase C — Frontend: My Timeclock enhancements

Department selection in correction requests, approved correction visualization.

- [x] Add department multi-select to correction request modal (shown when approval mode requires managers)
- [x] Department validation on submit (error message, not disabled button)
- [x] Create useQ_PageMyTimeclock_MyDepartments hook for employee's department memberships
- [x] Update useM_PageMyTimeclock_CorrectionTaskCreate to insert rel__correction_task__department junction rows
- [x] Approved corrections replace original bar with green highlight in day view
- [x] Side-by-side timeline comparison in day modal (920px width when approved correction exists)
- [x] Day modal scroll layout: sticky header, scrollable correction list, fixed footer
- [x] Remove correction banner from day rows entirely
- [x] Simplify approve/reject: plain labels, no confirmation dialogs
- [x] readOnly mode for PageMyTimeclock_DayModal (used by Timesheets employee modal)
- [x] Worked/break calculations use corrected values when approved correction exists

### Phase D — Frontend: Timesheets integration

HR Timesheets employee modal uses same components as My Timeclock.

- [x] Rewrite PageTimesheets_EmployeeModal to wire correction data via useQ_PageMyTimeclock_MyCorrectionTasks
- [x] Compute correctionTasksByDate map (same as Page_MyTimeclock)
- [x] Open PageMyTimeclock_DayModal with readOnly prop on day click
- [x] Timeline comparison in bar view expanded state and table view (DayTableCard)

### Phase E — Frontend: Polish

Tag contrast, entity selector scoping, toolbar standardization.

- [x] Override colorSuccessBg/colorSuccessText/colorErrorBg/colorErrorText in Provider_ANTD for readable Tag contrast
- [x] Add scope prop to App_EntitySelector ("organization" | "employee")
- [x] Add entityScope prop to App_PageToolbar (passes through to selector)
- [x] Migrate Page_MyTimeclock from inline native select to App_PageToolbar with entityScope="employee"
- [x] Remove unused toolbarExtra prop from App_TimeclockDetailView
- [x] Remove role badge tags from Corrections tab label
- [x] Task page layout: reduced top padding, Tabs as navigation only
- [x] Add realtime dev logging to useSupabaseRealtimeSync

## Context

_Stripped at /pp push time._

Non-tech: Full approval workflow for timeclock corrections — HR and managers review, approve, or reject employee correction requests with multi-department support and real-time updates.
Tech: 9 migrations under frontend/vite/supabase/migrations/. New pages under pages/Page_Apps/. Hooks under hooks/useQ_PageApps_* and useM_PageApps_*. Entity selector at components/app-shell/App_EntitySelector.tsx. Timeclock view at components/timeclock/App_TimeclockDetailView.tsx.
Related: [Timeclock](https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982)
Siblings: AHR-1978 (Done), AHR-1979 (Done), AHR-1981 (In Progress)
