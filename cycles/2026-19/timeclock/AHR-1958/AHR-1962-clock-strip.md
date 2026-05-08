# Clock in/out via horizontal nav

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1958](https://plane.jimbui.dev/aiur/browse/AHR-1958/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- Idle state: gray strip "Not clocked in | Clock In" dropdown shows entities where user has employee records (current org) with timezone
- Clocked in state: green strip with pulsing dot, entity name, live elapsed timer, Lunch + Clock Out buttons
- On lunch state: orange strip, entity name, lunch elapsed timer, Resume button
- Clock out returns strip to idle
- timeclock_events table with timeclock_event_type_enum (clock_in, clock_out, lunch_start, lunch_end)
- Per-org constraint: blocked from clocking into Entity B while clocked into Entity A in same org
- Cross-org overlap allowed
- All timestamps stored as TIMESTAMPTZ (UTC), displayed in entity timezone
- RLS: employees see own, admin/owner see all in org

## Scope boundaries

- No timesheet views — belongs to AHR-1963/AHR-1964
- No admin event editing/deletion
- No retroactive event insertion (created_at = now() is the single timestamp)
- Entity picker shows only entities where user has an employee record in current org
- Strip hidden when user has no employee records in current org

## Decisions

- **Decision:** Single timestamp column (created_at) — no separate event_at
  **Rationale:** Events always recorded in real-time. Retroactive insertion out of scope. Column can be added later if backdating is needed.
- **Decision:** organization_id trigger-populated from employee (child table pattern)
  **Rationale:** employees.organization_id is one hop. Employee is the natural parent FK.
- **Decision:** Per-org constraint via BEFORE INSERT trigger (not application-level)
  **Rationale:** DB-level enforcement per spec. ~2-5ms via indexed lookups on clock_in events only.
- **Decision:** useQ_Tables_MyEmployeeEntities is a shared hook
  **Rationale:** Also needed by My Timeclock (AHR-1963) and HR Timesheets (AHR-1964) for entity context.
- **Decision:** Schema evolved from events → sessions model
  **Rationale:** `timeclock_sessions` table (work/break with start_at, end_at, duration_ms) is cleaner than event-pairing. Events table kept for audit. All hooks now query sessions; compat shim maps back to events for legacy.
- **Decision:** `App_TimeclockEventDot` shared component for colored status dots
  **Rationale:** Pulsing colored dot used in strip chip, popover timeline, detail views. Centralizes color mapping + keyframe injection.
- **Decision:** Popover buttons changed from square (90×90) to rectangular (34px tall) with horizontal icon+text
  **Rationale:** Square buttons wasted space. Horizontal layout is more compact and standard.
- **Decision:** Timezone fallback from entity when idle
  **Rationale:** `status.entityTimezone` is null when idle. Fall back to first entity's timezone instead of UTC to show correct times in popover timeline.
- **Decision:** Timezone fix — `T00:00:00Z` suffix for UTC parsing in todayStart
  **Rationale:** Browser-local parsing of `T00:00:00` double-counted offset when browser tz matched entity tz. Fix applied to all date boundary calculations.

## Implementation

### Phase A — Migration: timeclock_events + enum + constraint

Create the timeclock events table, event type enum, RLS, per-org constraint trigger, and realtime.

- [x] Create timeclock_event_type_enum: clock_in, clock_out, lunch_start, lunch_end
- [x] Create timeclock_events table: id (generate_id('tce')), employee_id FK, entity_id FK, event_type, organization_id DEFAULT '' (trigger-populated), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- [x] Create set_org_id_from_employee() trigger function (reads employees.organization_id)
- [x] Create BEFORE INSERT trigger on timeclock_events
- [x] Indexes: employee_id, entity_id, organization_id, composite (employee_id, entity_id, created_at DESC)
- [x] RLS: admin_or_owner_can_* (full CRUD via is_admin_or_owner)
- [x] RLS: employee_can_view_own_timeclock_events SELECT via employee_id IN (SELECT id FROM employees WHERE user_id = (SELECT auth.uid()))
- [x] RLS: employee_can_insert_own_timeclock_events INSERT via same check
- [x] Per-org constraint trigger: on clock_in, check no open session at another entity in same org for same user
- [x] Add timeclock_events to notify_organization_of_table_change() realtime function
- [x] Create realtime trigger trg_notify_realtime_timeclock_events
- [x] Run pnpm sb:dev:types, add timeclock_events to QueryKeys

### Phase B — Query + mutation hooks + enum options

Build data-fetching hooks for the clock strip and shared entity query.

- [x] useQ_Tables_MyEmployeeEntities — shared hook: entities where current user has employee records in current org. Returns {employeeId, entityId, entityName, timezone}[]
- [x] useQ_Tables_MyTimeclockStatus — per-employee clock state: latest event to derive {state: 'idle' | 'clocked_in' | 'on_lunch', entityName, entityTimezone, sessionStartedAt, employeeId, entityId}
- [x] useM_TimeclockEvent_Create — insert clock event, invalidates both query keys
- [x] const_TimeclockEventsEventTypeOptions — enum options file

### Phase C — Clock strip UI

Add clock status strip to App_HorizontalNav with popover timeline and action buttons.

- [x] Create `App_ClockStrip` component with Popover (bottomRight placement)
- [x] Idle state: gray background, "Not clocked in", Clock In buttons per entity (rectangular, horizontal icon+text)
- [x] Entity picker: popover showing entities from `useQ_Tables_MyEmployeeEntities` with name + timezone
- [x] Clocked In state: indigo background, white pulsing dot (`App_TimeclockEventDot` with `color="#fff"`), entity name, live elapsed timer, Lunch + Clock Out buttons
- [x] On Lunch state: light indigo background, coffee icon, lunch elapsed timer, Resume button
- [x] Popover timeline: today's sessions with colored `App_TimeclockEventDot` per event, elapsed durations, "Working..." / "On Break..." active indicator with pulse
- [x] Timeline times formatted in entity timezone via `formatTimeInTz`
- [x] Timezone fallback: idle state uses first entity's timezone instead of UTC
- [x] Integrate into `App_HorizontalNav` (right side, before avatar)
- [x] Strip hidden when no employee records in current org

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during /s and for sibling awareness during concurrent /p sessions._

Non-tech: The clock strip is the most important daily touchpoint — employees see their clock status at all times in the top nav, with one-click actions for clock in/out and lunch breaks.
Tech: timeclock_events table (migration), App_ClockStrip in App_HorizontalNav.tsx, hooks in src/hooks/. Entity lookup via employees table (post-AHR-1966 schema: employees.entity_id IS the entity assignment). RLS via is_admin_or_owner + employee self-access. Realtime via notify_organization_of_table_change.
Related: [App Shell](https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) - clock strip lives in horizontal nav
Siblings: 6 total, 0 Done, 2 Cancelled — [AHR-1960 Entity-employee assignment (Cancelled), AHR-1961 Nav restructure (In Progress — planned), AHR-1963 My Timeclock (Todo), AHR-1964 HR Timesheets (Todo), AHR-1965 Onboarding wizard (Cancelled)]
Execution Order: Step 2 of 3 — AHR-1966 (step 1) Done, parallel with AHR-1961
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
