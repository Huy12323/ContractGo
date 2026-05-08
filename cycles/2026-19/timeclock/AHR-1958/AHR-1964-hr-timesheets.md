# HR Timesheets entity-scoped view

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1958](https://plane.jimbui.dev/aiur/browse/AHR-1958/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Entity dropdown using existing App_EntitySelector with timezone label
- Switching entity re-renders grid in that entity's timezone context
- Grid: employees (rows) × days (columns) with Total column
- Employee cell: avatar (initials), name, department
- Hour cells: plain numbers, green text ≥8h, orange text <8h, gray dash = no data, gray bg = weekend
- Live status dots next to employee name: green = working now, orange = on lunch, gray = not clocked in
- Totals row at bottom summing all employees per day
- View toggle: Week / Month / Cycle (no Day or Custom)
- Date navigation: ← → arrows with period label

## Scope boundaries

- No PTO/absent (red) coloring — requires Leave sub-module, show gray dash instead
- No Day or Custom view (low utility for multi-employee grid)
- No summary cards
- Reuses aggregation utility from AHR-1963
- No timesheet approval workflow — deferred
- No event editing from this view

## Decisions

- **Decision:** Plain number grid, no visual bars in cells
  **Rationale:** HR cares about numbers. Clean table is fastest to scan.
- **Decision:** Green text ≥8h, orange <8h for color coding
  **Rationale:** Simple threshold — full day vs partial. No complex gradients.
- **Decision:** Live status dots on employee name (not in hour cells)
  **Rationale:** Current status is per-employee, not per-day. One dot per row.
- **Decision:** No summary cards
  **Rationale:** Totals row + grid itself convey the data.
- **Decision:** Deferred: live status dots, department display, totals row
  **Rationale:** Core grid value is hour numbers and attendance pattern. Status dots, department in cells, and bottom totals row deferred to a follow-up — not blocking for v0.0.2.
- **Decision:** Added Custom date range view beyond original scope
  **Rationale:** RangePicker was trivial to add and useful for payroll period queries.
- **Decision:** SECURITY DEFINER RPC for grid aggregation
  **Rationale:** Per-row RLS evaluation across 137K sessions took 22s. Inlining the auth check once in the function body reduced this to 2.5s. Security equivalent — manual JWT check at function entry.
- **Decision:** Viewport-driven batch loading with `useQueries`
  **Rationale:** PostgREST `db-max-rows` caps at 1000 rows. Dynamic batch size (`900/numDays`) per employee group, enabled on scroll via `onVisibleRegionChanged`. First visible batch loads in ~100ms.
- **Decision:** Backend employee search via `ilike` on `__full_name`
  **Rationale:** With batch loading, client-side search would require loading all batches. Server-side ilike with 300ms debounce keeps it efficient.
- **Decision:** Airtable-style expand icon on employee column
  **Rationale:** Clicking any cell to open the detail modal was ambiguous. Hover-reveal expand icon (Lucide Maximize2) with `drawCell` + `updateCells` provides clear affordance. Shared via `GRID_EXPAND_ICON` config and `drawExpandIcon()` in `useGlideTheme.ts`.
- **Decision:** Employee detail modal delegates to shared `App_TimeclockDetailView`
  **Rationale:** Same view (bar/table, period selector, timeline) used in My Timeclock page. One component, two consumers.

Original Estimate: 5 points

## Implementation

### Phase A — Data layer

Fetch all sessions for all employees in the selected entity within a date range. SECURITY DEFINER RPC bypasses per-row RLS for aggregation performance.

- [x] `get_timesheet_grid` RPC — SECURITY DEFINER with inlined JWT auth check, returns (employee_id, work_date, worked_ms, break_ms)
- [x] `useQ_Tables_TimesheetGrid` — batch-loading hook using `useQueries`, viewport-driven via `enabledBatches` set
- [x] `useQ_Tables_EntityTimeclockLiveStatus` — fetch open sessions per employee for live status
- [x] `useQ_Tables_EntityTimeclockEventsToday` — fetch today's sessions for live worked overlay
- [x] Migration: `20260508094758_timeclock_grid_rpc_security_definer.sql` — SECURITY DEFINER RPC
- [x] Migration: `20260508160000_timeclock_grid_batch_loading.sql` — `p_employee_ids TEXT[]` filter + composite index

### Phase B — Page layout + state

Replace the Timesheets route stub with the full page component. Backend search, batch loading orchestration.

- [x] `Page_Timesheets` component replacing route stub
- [x] `App_PageToolbar` with entity selector (shows timezone)
- [x] View mode state (Week/Month/Cycle/Custom) with ANTD Segmented
- [x] Date navigation: ← → buttons + period label + Today button
- [x] Backend employee search: `searchText` → 300ms debounce → `ilike __full_name` server-side
- [x] Batch orchestration: dynamic `batchSize = floor(900/numDays)`, `empToBatch` mapping, `enabledBatchesRef` grows on scroll

### Phase C — Grid rendering

Glide Data Grid with employee rows, day columns, Airtable-style expand icon.

- [x] Grid header: Employee column (210px) + Total (80px) + day columns (68px) with custom two-line draw (day name + date)
- [x] Employee cell: name with expand icon padding (`cellHorizontalPadding: 34`), pointer cursor
- [x] Airtable-style expand icon: `drawExpandIcon()` on hover via `onItemHovered` + `updateCells` damage, shared `GRID_EXPAND_ICON` config
- [x] Hour cells: decimal hours (e.g., "8.50h"), indigo dark ≥8h, indigo soft <8h, gray dash = no data, gray bg = weekend
- [x] Total column per employee (sum of all days)
- [x] Frozen columns (Employee + Total), smooth scroll, row markers
- [x] Employee detail modal via shared `App_TimeclockDetailView`

## Context

_Stripped at /pp push time._

Non-tech: HR admin overview of all employees' hours at a specific entity. Quick scan for attendance, missing clock-ins, and overtime across the team.
Tech: Page at `/$organizationId/timesheets` (route stub exists). Employee data from `useQ_Tables_OrgEmployees({ entityId })`. Events from `useQ_Tables_EntityTimeclockEvents`. Entity selector from `App_EntitySelector`. Aggregation utilities shared from AHR-1963. ANTD Table or custom grid with theme tokens.
Related: [App Shell](https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) - nav routes to this page
Siblings: 6 total, 2 Done (local), 2 Cancelled — [AHR-1960 (Cancelled), AHR-1961 Nav restructure (Done local), AHR-1962 Clock strip (Done local), AHR-1963 My Timeclock (Todo), AHR-1965 (Cancelled)]
Execution Order: Step 3 of 3 — AHR-1961+AHR-1962 (step 2) Done (local) ✓, parallel with AHR-1963
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
