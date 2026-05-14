# Employee correction requests

> Version: [Outline](https://outline.jimbui.dev/doc/4af8ce40-4988-4719-a627-b1af569b4fee) | Tier 1: [AHR-1977](https://plane.jimbui.dev/aiur/browse/AHR-1977/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Employee can click a day row in My Timeclock to open a day detail modal showing sessions + correction status
- Correction form uses a "bandage" visual timeline editor: palette (work/break/inactive) + drag-to-paint patches on a 24h bar + live merged preview
- Each drawn patch has a floating field for exact time control (TimePicker) and type change
- Drag snaps to 5-minute intervals; floating fields allow arbitrary precision
- Submitted correction creates a correction_task (pending) with associated timeclock_corrections entries
- Employee can view correction status inline on day bars in My Timeclock
- "Corrections" toolbar button highlights/filters days with corrections
- Employee can cancel a pending correction from the day detail modal
- Cannot submit duplicate correction for same day while one is already pending
- Cannot edit an already-approved or already-rejected correction

## Scope boundaries

- No HR approval UI — that's AHR-1980
- No entity approval settings — that's AHR-1981
- No HR Timesheets integration for corrections — employee-only in My Timeclock
- No correction editing after submission — cancel and re-submit instead

## Decisions

- **Decision:** PUT (replace) approach — edit-in-place form pre-populated from existing sessions
  **Rationale:** Initially considered PATCH (bandage/paint) approach, switched to PUT after analysis. PUT handles all scenarios uniformly (edit existing, add forgotten sessions, remove sessions), is faster for the 80% case (1 field edit vs. 3-5 drawing actions), works on mobile, and is half the code. Still shows before/after bar comparison for visual clarity.
- **Decision:** "Exclude all, add all" session linkage strategy
  **Rationale:** On submit, ALL original sessions get 0-duration correction entries with session_id (exclusion markers), and the full proposed timeline is added as new entries without session_id. Avoids complex partial-overlap session matching. The RPC's NOT EXISTS check excludes the originals, UNION ALL adds the proposed entries.
- **Decision:** Day detail modal (not inline expansion) for single-day view
  **Rationale:** User-directed — click day row opens modal with session bar + timeline + correction features. Reuses App_TimeclockBar24 for the bar rendering.

Original Estimate: 5 points

## Implementation

### Phase A — Data layer

Query and mutation hooks for correction CRUD operations.

- [x] Create `useQ_PageMyTimeclock_MyCorrectionTasks` — fetches current employee's correction_tasks with `select('*, days(date, timezone)')`, keyed by `[...QueryKeys.correction_tasks.list(), { employeeId }]`. Returns `{ query, correctionTasks, correctionTasksByDate }` (Map for O(1) date lookup)
- [x] Create `useM_PageMyTimeclock_CorrectionTaskCreate` — multi-step insert: (1) check no pending correction exists for the day+employee, (2) insert correction_task, (3) batch insert timeclock_corrections with returned task ID. Invalidates `correction_tasks.list()` + `timeclock_corrections.list()`. Uses `get_or_create_day()` RPC for day_id resolution
- [x] Create `useM_PageMyTimeclock_CorrectionTaskCancel` — updates correction_task status to `'cancelled'` where id matches and current status is `'pending'`. Invalidates `correction_tasks.list()`

### Phase B — Day detail modal

Modal showing single-day timeclock detail with correction entry point.

- [x] Create `PageMyTimeclock_DayModal` — ANTD Modal showing: day's sessions via App_TimeclockBar24, timeline detail (session list with timestamps + durations), summary totals (worked/break). Props: dayDate, sessions, timezone, correctionTask (optional), onRequestCorrection, onCancelCorrection
- [x] Show correction status badge (ANTD Tag) if correction_task exists for this day — pending (processing), approved (success), rejected (error), cancelled (default)
- [x] "Request Correction" button — opens correction editor view within modal. Disabled with tooltip if pending correction exists
- [x] Cancel pending correction action — confirm modal → calls `useM_PageMyTimeclock_CorrectionTaskCancel`

### Phase C — Bandage correction editor

Visual timeline painter inside the day modal. Core interactive component.

- [x] Create `PageMyTimeclock_CorrectionEditor` — 2-layer layout: (1) current sessions bar via App_TimeclockBar24 (read-only), (2) preview bar computed from form entries. Switched from PATCH (bandage painter) to PUT (edit-in-place form)
- [x] Pre-populated entry rows from existing sessions — each row: type selector (Work/Break), start TimePicker, end TimePicker, duration, delete button
- [x] Add entry button — appends a new row starting after the last entry
- [x] Live preview bar — App_TimeclockBar24 rendered from form entries + total worked/break summary
- [x] Change detection — compares current entries vs initial entries, disables submit if no changes
- [x] Reason message input (ANTD Input.TextArea) + submit button (ANTD Button primary)
- [x] Submit handler — (a) for each original session on the day: create correction entry with session_id + duration_ms=0 + same type (exclusion marker), (b) for each form entry: create correction entry without session_id, with computed start_at/end_at/duration_ms/type. Calls `useM_PageMyTimeclock_CorrectionTaskCreate` with all entries

### Phase D — My Timeclock page integration

Wire components into existing page flow.

- [x] Add day row click handler in App_TimeclockDetailView (or Page_MyTimeclock wrapper) → opens `PageMyTimeclock_DayModal` with selected day's sessions
- [x] Inline correction indicators on day bar rows — small ANTD Tag/Badge showing correction status per day, data from `useQ_PageMyTimeclock_MyCorrectionTasks` correlated by date string
- [ ] "Corrections" toolbar button — borderless text button (type="text", size="small") in the My Timeclock sticky toolbar. Toggles highlight/filter for days with corrections
- [ ] Verify: submit correction → appears as pending badge on day bar → cancel works → timesheet grid output unchanged (corrections are pending, not approved)

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Employees can request corrections for specific days when the system-recorded times don't match reality. Visual "bandage" editor lets them paint corrected time over the recorded day.
Tech: Schema in place from AHR-1978 (correction_tasks, timeclock_corrections, days tables + RLS + RPC). New hooks in src/hooks/, new components in src/pages/Page_MyTimeclock/. Reuses App_TimeclockBar24 for bar rendering. Existing mutation pattern: useM_TimeclockEvent_Create. Key files: Page_MyTimeclock.tsx, App_TimeclockDetailView.tsx, App_TimeclockBar24.tsx, useQ_Tables_TimeclockEvents.ts, utils_Timeclock_AggregateEvents.ts
Related: [Timeclock](https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982) - module spec
Siblings: 4 total, 0 Done — [AHR-1978 Days+corrections schema (In Progress, effectively Done local), AHR-1980 HR correction approval (Todo), AHR-1981 Entity approval settings (Todo)]
Execution Order: Step 2 of 3 (parallel with AHR-1981) — prerequisite AHR-1978 effectively done (all tasks checked except browser verification)
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
