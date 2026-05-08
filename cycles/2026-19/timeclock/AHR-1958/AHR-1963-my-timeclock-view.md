# My Timeclock employee view

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1958](https://plane.jimbui.dev/aiur/browse/AHR-1958/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Entity selector at top — auto-select if single entity, dropdown if multiple (reuse useQ_Tables_MyEmployeeEntities)
- View toggle: Day / Week (default) / Month / Cycle / Custom date range — all modes functional
- Date navigation: ← → arrows with period label, "Today" quick-jump
- Day and Week views: 24-segment timeline bar (0–24h) with colored work/lunch blocks, timestamps at start/end of each segment, legend on top
- Month/Cycle/Custom views: plain number table with Worked, Breaks, Extra Hours columns
- Week view: 7 rows each with a compact 24h bar + total hours
- Day view: full-width 24h bar + event list below + stats (worked/lunch/remaining)
- Today row highlighted (blue border), future days grayed, weekends "Off"
- Period state badge: "In Progress" for current period, "Closed" for past
- All times displayed in selected entity's timezone
- FE event aggregation: pair clock_in/clock_out and lunch_start/lunch_end into sessions

## Scope boundaries

- No Planned/Balance/Absences columns — requires Shifts and Leave sub-modules (deferred)
- No summary cards — bars and tables are self-explanatory
- Cycle view = biweekly period (placeholder until Shifts provides pay cycle config)
- No event editing from this view
- Aggregation on FE only (no DB functions)

## Decisions

- **Decision:** Day/Week use 24-segment visual bars; Month/Cycle/Custom use plain number tables
  **Rationale:** Bars are intuitive at day/week scale. At month scale bars compress too much — numbers are clearer.
- **Decision:** Timestamps at start AND end of every segment in the bar
  **Rationale:** User can read exact times without expanding detail. Legend on top replaces per-entry Work/Lunch labels.
- **Decision:** No summary cards on any view
  **Rationale:** Bars and tables communicate the data directly.
- **Decision:** FE event aggregation (pair events → sessions → durations)
  **Rationale:** Simpler than DB function for v0.0.2. Shared utility reused by AHR-1964.
- **Decision:** Extracted shared `App_TimeclockDetailView` component
  **Rationale:** My Timeclock and HR Timesheets detail modal share identical views (bar/table, period selector, timeline, day drill-down). Single component, two consumers — page wrapper and modal wrapper.
- **Decision:** `App_TimeclockEventDot` shared component for status indicators
  **Rationale:** Colored dots with optional pulse animation used in ClockStrip, detail view timeline, and day bar view. Centralizes color mapping + keyframe injection.
- **Decision:** "Working..." / "On Break..." active indicators in all views
  **Rationale:** Open sessions should be visible at every zoom level — day bar, week row, month row, and table timeline.
- **Decision:** Sessions model (`useQ_Tables_TimeclockSessions`) replaces event-pairing on FE
  **Rationale:** Backend `timeclock_sessions` table (from AHR-1962 schema evolution) is cleaner than client-side event pairing. Compat shim `useQ_Tables_TimeclockEvents` kept for legacy consumers.
- **Decision:** Timezone fix — `T00:00:00Z` suffix for UTC parsing
  **Rationale:** `new Date("...T00:00:00")` without Z was parsed in browser local timezone, double-counting the offset when the browser tz matched the target tz. Fixed in all date boundary calculations.

## Implementation

### Phase A — Data layer + utilities

Session fetching hook and FE aggregation/date-range utilities shared across views and reused by AHR-1964.

- [x] `useQ_Tables_TimeclockSessions` — fetch sessions for given employee ID(s) within UTC date range, 60s refetch interval
- [x] `useQ_Tables_TimeclockEvents` — compat shim mapping sessions → events for legacy consumers
- [x] `utils_Timeclock_AggregateEvents` — pair clock_in/clock_out and lunch_start/lunch_end into sessions, compute per-day: worked hours, break duration, extra hours (over 8h), `formatDuration` (decimal hours), `formatTimeInTz`
- [x] `utils_Timeclock_DateRange` — calculate start/end dates for day/week/month/cycle/custom, prev/next navigation, period label formatting
- [x] `const_Timeclock_Colors` — centralized color palette (work indigo, lunch light-indigo, idle gray)

### Phase B — Page layout + state

`Page_MyTimeclock` is a thin wrapper around the shared `App_TimeclockDetailView`.

- [x] `Page_MyTimeclock` — entity selector + shared detail view component
- [x] Entity selector using `useQ_Tables_MyEmployeeEntities` — auto-select if single, dropdown if multiple
- [x] `App_TimeclockDetailView` — shared component owning all view state, data fetching, and rendering
- [x] Sticky toolbar with view mode (Day/Week/Month/Cycle/Custom), display mode (bar/table), date nav, period badge
- [x] `toolbarExtra` prop for injecting entity selector into shared toolbar

### Phase C — Day + Week views (24h bars)

Visual timeline bars with 24 hour segments, colored work/lunch blocks, and timestamps at segment edges.

- [x] `App_TimeclockBar24` component: 24 equal segments with hour grid lines, work/lunch nesting, timestamp labels
- [x] `App_TimeclockLegend` — color legend (Work, Lunch, Idle)
- [x] `App_TimeclockBar24HourRuler` — shared 24h ruler (0, 3, 6, 9, 12, 15, 18, 21, 24)
- [x] Day view: full-width bar + stats (worked/break/remaining) + session list + active indicator
- [x] Day view: NOW marker (red line with timestamp) on current day
- [x] Week view: 7 rows with day label + compact bar + total hours, click to drill into Day
- [x] Week view: shared hour ruler at top
- [x] Today row blue-bordered, future rows faded, weekends "Off"
- [x] "Working..." / "On Break..." with `App_TimeclockEventDot` pulse in all bar views

### Phase D — Month / Cycle / Custom views

Compact bar + number table views for longer date ranges, with table timeline alternative.

- [x] `DayCompactRow` — compact bar + Worked + Breaks columns for month/cycle/custom
- [x] `DayTableCard` — event timeline per day with colored dots, elapsed times, active indicators
- [x] Month/Cycle/Custom bar view with legend and column headers
- [x] Table view as alternative display mode (bar ↔ table toggle)
- [x] Click a day row to drill into Day view

## Context

_Stripped at /pp push time._

Non-tech: Employee personal timesheet — visual timeline bars for day/week, number tables for longer periods. The most detailed self-service view of their work hours.
Tech: Page at `/$organizationId/my-timeclock` (route stub exists). Data from `timeclock_events` via `useQ_Tables_TimeclockEvents`. Entity context from `useQ_Tables_MyEmployeeEntities`. Aggregation utility shared with AHR-1964. ANTD components + theme tokens. 24h bar is a custom component.
Related: [App Shell](https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) - nav routes to this page
Siblings: 6 total, 2 Done (local), 2 Cancelled — [AHR-1960 (Cancelled), AHR-1961 Nav restructure (Done local), AHR-1962 Clock strip (Done local), AHR-1964 HR Timesheets (Todo), AHR-1965 (Cancelled)]
Execution Order: Step 3 of 3 — AHR-1961+AHR-1962 (step 2) Done (local) ✓, parallel with AHR-1964
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
