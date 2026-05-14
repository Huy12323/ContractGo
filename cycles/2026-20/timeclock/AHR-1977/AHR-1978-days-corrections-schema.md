# Days + corrections schema + unified query

> Version: [Outline](https://outline.jimbui.dev/doc/4af8ce40-4988-4719-a627-b1af569b4fee) | Tier 1: [AHR-1977](https://plane.jimbui.dev/aiur/browse/AHR-1977/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9ae66923-754e-4ed1-b8e0-bdf330df94b0/)

## Requirements

- `days` dimension table exists with date, generated day/month/year, timezone, UNIQUE(date, timezone)
- `get_or_create_day(date, tz)` function lazily creates and returns day_id
- `timeclock_sessions.day_id` FK populated for all existing rows (backfill) and auto-assigned on new inserts
- Clock-in flow assigns day_id on new sessions (via trigger, no frontend change)
- Midnight cron assigns day_id when splitting sessions (via trigger, no cron change)
- `correction_tasks` table exists (status: pending/approved/rejected/cancelled, employee message, approval metadata)
- `timeclock_corrections` table exists (type work/break, start_at, end_at, duration_ms — mirrors sessions)
- `get_timesheet_grid()` RPC queries through days.id and merges approved corrections via UNION ALL + NOT EXISTS
- RLS policies on all new tables (admin_or_owner CRUD, employee can SELECT/INSERT own correction_tasks)
- Existing timesheet views work identically after migration
- Manually inserting an approved correction changes the timesheet grid output for that employee/day

## Scope boundaries

- No frontend UI for corrections — that's AHR-1979 (employee requests) and AHR-1980 (HR approval)
- No entity approval settings — that's AHR-1981
- No dim_date attributes (is_holiday, pay_period_id) — deferred to payroll
- The RPC return signature is unchanged — frontend hooks don't need updating

## Decisions

- **Decision:** BEFORE INSERT trigger on timeclock_sessions auto-assigns day_id from start_at + entity timezone
  **Rationale:** Covers clock-in hook + midnight cron + any future write path. No need to modify useM_TimeclockEvent_Create.ts or timeclock_process_midnight(). Same pattern as trigger_set_org_id_timeclock_sessions.
- **Decision:** All schema changes in one migration file
  **Rationale:** Tightly coupled — correction tables reference days, RPC needs all tables.
- **Decision:** Backfill via batch INSERT DISTINCT days + UPDATE JOIN (not per-row function call)
  **Rationale:** 1.2M rows at scale — per-row get_or_create_day() would be too slow.

## Implementation

### Phase A — Days table + helper function

Create the `days` shared dimension table and the lazy-creation helper.

- [x] Create `days` table: id TEXT PK generate_id('day'), date DATE NOT NULL, day/month/year SMALLINT GENERATED, timezone TEXT NOT NULL, UNIQUE(date, timezone)
- [x] Create indexes: idx_days_date_timezone (covered by UNIQUE), idx_days_year_month (for range queries)
- [x] Create `get_or_create_day(p_date DATE, p_tz TEXT) RETURNS TEXT` — INSERT ON CONFLICT DO UPDATE SET date=EXCLUDED.date RETURNING id

### Phase B — day_id on timeclock_sessions + trigger + backfill

Add the FK column, auto-assignment trigger, and backfill existing data.

- [x] ALTER TABLE timeclock_sessions ADD COLUMN day_id TEXT REFERENCES days(id)
- [x] Create function `set_day_id_for_session()` — BEFORE INSERT trigger: lookup entity timezone, compute (NEW.start_at AT TIME ZONE tz)::date, call get_or_create_day(), set NEW.day_id
- [x] Create trigger `trigger_set_day_id_timeclock_sessions` BEFORE INSERT on timeclock_sessions
- [x] Backfill: INSERT INTO days SELECT DISTINCT (s.start_at AT TIME ZONE e.timezone)::date, e.timezone FROM timeclock_sessions s JOIN entities e ON e.id = s.entity_id ON CONFLICT DO NOTHING
- [x] Backfill: UPDATE timeclock_sessions s SET day_id = d.id FROM entities e JOIN days d ON d.date = (s.start_at AT TIME ZONE e.timezone)::date AND d.timezone = e.timezone WHERE s.entity_id = e.id AND s.day_id IS NULL
- [x] ALTER TABLE timeclock_sessions ALTER COLUMN day_id SET DEFAULT '' + SET NOT NULL
- [x] Create index idx_tcs_day_id on timeclock_sessions(day_id)

### Phase C — Correction tables

Create the two-level correction model with RLS.

- [x] Create TYPE correction_task_status_enum AS ENUM ('pending', 'approved', 'rejected', 'cancelled')
- [x] Create `correction_tasks` table: id generate_id('ctk'), day_id FK days, employee_id FK employees, entity_id FK entities, organization_id (trigger-populated), status correction_task_status_enum DEFAULT 'pending', message TEXT, approved_by UUID, approved_at TIMESTAMPTZ, rejected_by UUID, rejected_at TIMESTAMPTZ, created_at, updated_at
- [x] Create trigger_set_org_id_correction_tasks (reuse set_org_id_from_entity pattern)
- [x] Create `timeclock_corrections` table: id generate_id('tcr'), correction_task_id FK correction_tasks ON DELETE CASCADE, day_id FK days, session_id TEXT REFERENCES timeclock_sessions(id) ON DELETE SET NULL, type timeclock_session_type_enum, start_at TIMESTAMPTZ, end_at TIMESTAMPTZ, duration_ms BIGINT, created_at, updated_at
- [x] RLS on correction_tasks: admin_or_owner SELECT/UPDATE/DELETE, employee SELECT/INSERT own (employee_id IN SELECT id FROM employees WHERE user_id = auth.uid())
- [x] RLS on timeclock_corrections: admin_or_owner SELECT/UPDATE/DELETE, employee SELECT/INSERT via correction_task ownership
- [x] Indexes: idx_correction_tasks_day_id, idx_correction_tasks_employee_id, idx_correction_tasks_entity_id, idx_correction_tasks_organization_id, idx_correction_tasks_status, idx_tcr_correction_task_id, idx_tcr_day_id, idx_tcr_session_id

### Phase D — Update get_timesheet_grid() RPC

Rewrite the RPC to query through days and merge corrections.

- [x] CREATE OR REPLACE get_timesheet_grid() — queries through days CTE, same return signature (employee_id, work_date, worked_ms, break_ms)
- [x] Unified query: CTE with sessions (NOT EXISTS approved corrections on session_id) UNION ALL approved correction entries, grouped by employee_id + day_id, joined back to days.date for work_date output
- [x] Verify: EXPLAIN ANALYZE on seeded 5k employees — 393ms (comparable to baseline 355ms)

### Phase E — Type regeneration + verification

- [x] Run pnpm sb:dev:types to regenerate database.types.ts
- [x] Verify frontend compiles (npx tsc --noEmit — clean)
- [ ] Verify existing timesheet views load correctly in browser

## Context

_Stripped at /pp push time._

Non-tech: Foundation schema for correction feature — no visible UI changes, but enables corrections to appear in timesheet data.
Tech: Single migration file under frontend/vite/supabase/migrations/. Existing write paths: useM_TimeclockEvent_Create.ts (React hook, direct SDK insert), timeclock_process_midnight() (PL/pgSQL cron, raw INSERT). Both covered by BEFORE INSERT trigger — no modifications needed. Current RPC: get_timesheet_grid() in 20260508160000_timeclock_grid_batch_loading.sql.
Related: [App Shell](https://outline.jimbui.dev/doc/app-shell-doc-id) - clock strip calls useM_TimeclockEvent_Create
Siblings: 4 total, 0 Done — [AHR-1979 Employee correction requests (Todo), AHR-1980 HR correction approval (Todo), AHR-1981 Entity approval settings (Todo)]
Execution Order: Step 1 of 3 — no prerequisites, this is the foundation
Outline Spec: https://outline.jimbui.dev/doc/f8a05b43-ff37-4937-9411-bf93c2095982
