-- ============================================
-- Add timezone to timeclock tables, fix midnight split to use entity TZ,
-- clock_out trigger, and cron for overnight sessions
-- ============================================

-- PHASE 1: Add timezone to timeclock_events
ALTER TABLE public.timeclock_events
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Backfill timezone from entity
UPDATE public.timeclock_events te
SET timezone = ent.timezone::text
FROM public.entities ent
WHERE te.entity_id = ent.id AND te.timezone = 'UTC';

-- Trigger to auto-populate timezone from entity on insert
CREATE OR REPLACE FUNCTION public.set_timeclock_event_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- organization_id from employee
    SELECT organization_id INTO NEW.organization_id
    FROM public.employees WHERE id = NEW.employee_id;
    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_id %', NEW.employee_id;
    END IF;

    -- timezone from entity
    SELECT timezone::text INTO NEW.timezone
    FROM public.entities WHERE id = NEW.entity_id;
    IF NEW.timezone IS NULL THEN
        NEW.timezone := 'UTC';
    END IF;

    RETURN NEW;
END;
$$;

-- Replace old org-only trigger with combined metadata trigger
DROP TRIGGER IF EXISTS trigger_set_org_id_timeclock_events ON public.timeclock_events;
CREATE TRIGGER trigger_set_timeclock_event_metadata
    BEFORE INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.set_timeclock_event_metadata();

-- PHASE 2: Restructure timeclock_summaries — add timezone, remove unique constraint
DROP TRIGGER IF EXISTS trigger_timeclock_events_recalc_summary ON public.timeclock_events;
DROP FUNCTION IF EXISTS public.timeclock_events_recalc_trigger();
DROP FUNCTION IF EXISTS public.timeclock_recalc_daily_summaries(TEXT, TEXT);

-- Add timezone column
ALTER TABLE public.timeclock_summaries
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Drop the unique constraint (multiple sessions per day allowed)
ALTER TABLE public.timeclock_summaries
    DROP CONSTRAINT IF EXISTS timeclock_summaries_employee_id_entity_id_date_key;

-- Backfill timezone
UPDATE public.timeclock_summaries ts
SET timezone = ent.timezone::text
FROM public.entities ent
WHERE ts.entity_id = ent.id AND ts.timezone = 'UTC';

-- Trigger to auto-populate org_id + timezone on summary insert
CREATE OR REPLACE FUNCTION public.set_timeclock_summary_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.employees WHERE id = NEW.employee_id;
    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_id %', NEW.employee_id;
    END IF;

    SELECT timezone::text INTO NEW.timezone
    FROM public.entities WHERE id = NEW.entity_id;
    IF NEW.timezone IS NULL THEN
        NEW.timezone := 'UTC';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_org_id_timeclock_summaries ON public.timeclock_summaries;
CREATE TRIGGER trigger_set_timeclock_summary_metadata
    BEFORE INSERT ON public.timeclock_summaries
    FOR EACH ROW
    EXECUTE FUNCTION public.set_timeclock_summary_metadata();

-- PHASE 3: Clock-out trigger
-- When clock_out is inserted, calculate session(s) and write summary rows.
-- Splits at entity-timezone midnight. worked_ms = gross session - break_ms.
CREATE OR REPLACE FUNCTION public.timeclock_on_clock_out()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz TEXT;
    v_clock_in_at TIMESTAMPTZ;
    v_events RECORD;
    v_seg_start TIMESTAMPTZ;
    v_seg_end TIMESTAMPTZ;
    v_seg_type TEXT; -- 'work' or 'break'
    v_segments RECORD;
    v_day DATE;
    v_local_midnight TIMESTAMPTZ;
    v_ms BIGINT;
    v_day_worked BIGINT;
    v_day_break BIGINT;
    v_current_day DATE;
    v_work_segments BIGINT[];
    v_break_segments BIGINT[];
BEGIN
    IF NEW.event_type != 'clock_out' THEN
        RETURN NEW;
    END IF;

    -- Get timezone
    v_tz := COALESCE(NEW.timezone, 'UTC');

    -- Find the clock_in that starts this session (latest clock_in before this clock_out
    -- for same employee+entity with no clock_out in between)
    SELECT created_at INTO v_clock_in_at
    FROM public.timeclock_events
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND event_type = 'clock_in'
      AND created_at < NEW.created_at
      AND NOT EXISTS (
          SELECT 1 FROM public.timeclock_events co
          WHERE co.employee_id = NEW.employee_id
            AND co.entity_id = NEW.entity_id
            AND co.event_type = 'clock_out'
            AND co.created_at > timeclock_events.created_at
            AND co.created_at < NEW.created_at
      )
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_clock_in_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Delete any existing summaries for this session range (idempotent recalc)
    DELETE FROM public.timeclock_summaries
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date
      AND date <= (NEW.created_at AT TIME ZONE v_tz)::date;

    -- Walk through events in this session, build work/break segments and split at TZ midnight
    -- We accumulate per-day totals
    DECLARE
        v_last_type TEXT := 'clock_in';
        v_last_at TIMESTAMPTZ := v_clock_in_at;
        ev RECORD;
    BEGIN
        FOR ev IN
            SELECT event_type, created_at
            FROM public.timeclock_events
            WHERE employee_id = NEW.employee_id
              AND entity_id = NEW.entity_id
              AND created_at > v_clock_in_at
              AND created_at <= NEW.created_at
            ORDER BY created_at ASC
        LOOP
            IF ev.event_type = 'lunch_start' AND v_last_type IN ('clock_in', 'lunch_end') THEN
                -- Work segment
                PERFORM _timeclock_add_segment(
                    NEW.employee_id, NEW.entity_id, v_tz,
                    v_last_at, ev.created_at, 'work'
                );
                v_last_type := 'lunch_start';
                v_last_at := ev.created_at;

            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                -- Break segment
                PERFORM _timeclock_add_segment(
                    NEW.employee_id, NEW.entity_id, v_tz,
                    v_last_at, ev.created_at, 'break'
                );
                v_last_type := 'lunch_end';
                v_last_at := ev.created_at;

            ELSIF ev.event_type = 'clock_out' THEN
                IF v_last_type IN ('clock_in', 'lunch_end') THEN
                    PERFORM _timeclock_add_segment(
                        NEW.employee_id, NEW.entity_id, v_tz,
                        v_last_at, ev.created_at, 'work'
                    );
                ELSIF v_last_type = 'lunch_start' THEN
                    PERFORM _timeclock_add_segment(
                        NEW.employee_id, NEW.entity_id, v_tz,
                        v_last_at, ev.created_at, 'break'
                    );
                END IF;
                v_last_type := 'clock_out';
                v_last_at := ev.created_at;
            END IF;
        END LOOP;
    END;

    RETURN NEW;
END;
$$;

-- Helper: add a work or break segment, splitting at timezone midnight
CREATE OR REPLACE FUNCTION public._timeclock_add_segment(
    p_employee_id TEXT,
    p_entity_id TEXT,
    p_tz TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_type TEXT -- 'work' or 'break'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cursor TIMESTAMPTZ := p_start;
    v_day DATE;
    v_next_midnight TIMESTAMPTZ;
    v_seg_end TIMESTAMPTZ;
    v_ms BIGINT;
BEGIN
    WHILE v_cursor < p_end LOOP
        v_day := (v_cursor AT TIME ZONE p_tz)::date;
        v_next_midnight := ((v_day + 1)::timestamp AT TIME ZONE p_tz);

        IF v_next_midnight > p_end THEN
            v_seg_end := p_end;
        ELSE
            v_seg_end := v_next_midnight;
        END IF;

        v_ms := EXTRACT(EPOCH FROM (v_seg_end - v_cursor))::BIGINT * 1000;

        IF v_ms > 0 THEN
            IF p_type = 'work' THEN
                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
                VALUES (p_employee_id, p_entity_id, v_day, v_ms, 0)
                ON CONFLICT ON CONSTRAINT timeclock_summaries_pkey DO NOTHING;

                -- Since we removed UNIQUE, use upsert by matching existing row
                UPDATE public.timeclock_summaries
                SET worked_ms = worked_ms + v_ms, updated_at = now()
                WHERE employee_id = p_employee_id
                  AND entity_id = p_entity_id
                  AND date = v_day
                  AND id = (
                      SELECT id FROM public.timeclock_summaries
                      WHERE employee_id = p_employee_id
                        AND entity_id = p_entity_id
                        AND date = v_day
                      ORDER BY created_at DESC
                      LIMIT 1
                  );
            ELSE
                UPDATE public.timeclock_summaries
                SET break_ms = break_ms + v_ms, updated_at = now()
                WHERE employee_id = p_employee_id
                  AND entity_id = p_entity_id
                  AND date = v_day
                  AND id = (
                      SELECT id FROM public.timeclock_summaries
                      WHERE employee_id = p_employee_id
                        AND entity_id = p_entity_id
                        AND date = v_day
                      ORDER BY created_at DESC
                      LIMIT 1
                  );
            END IF;
        END IF;

        v_cursor := v_seg_end;
    END LOOP;
END;
$$;

CREATE TRIGGER trigger_timeclock_on_clock_out
    AFTER INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.timeclock_on_clock_out();

-- PHASE 4: Cron job — handle overnight sessions
-- Runs hourly. For any open session that has crossed local midnight,
-- ensures a summary row exists for the previous day(s).
CREATE OR REPLACE FUNCTION public.timeclock_cron_overnight_splits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
    v_tz TEXT;
    v_clock_in_at TIMESTAMPTZ;
    v_last_event_at TIMESTAMPTZ;
    v_last_event_type TEXT;
    v_today_local DATE;
    v_last_summary_date DATE;
BEGIN
    -- Find all open sessions: last event per employee+entity is clock_in or lunch_end
    FOR r IN
        SELECT DISTINCT ON (te.employee_id, te.entity_id)
            te.employee_id, te.entity_id, te.event_type, te.created_at, te.timezone
        FROM public.timeclock_events te
        WHERE te.event_type IN ('clock_in', 'lunch_end', 'lunch_start')
          AND NOT EXISTS (
              SELECT 1 FROM public.timeclock_events co
              WHERE co.employee_id = te.employee_id
                AND co.entity_id = te.entity_id
                AND co.event_type = 'clock_out'
                AND co.created_at > te.created_at
          )
        ORDER BY te.employee_id, te.entity_id, te.created_at DESC
    LOOP
        v_tz := COALESCE(r.timezone, 'UTC');
        v_today_local := (now() AT TIME ZONE v_tz)::date;

        -- Find the clock_in that started this session
        SELECT created_at INTO v_clock_in_at
        FROM public.timeclock_events
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND event_type = 'clock_in'
          AND created_at <= r.created_at
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_clock_in_at IS NULL THEN CONTINUE; END IF;

        -- Check if the session's clock_in day (local) is before today (local)
        IF (v_clock_in_at AT TIME ZONE v_tz)::date >= v_today_local THEN
            CONTINUE; -- Same day, no overnight split needed
        END IF;

        -- Find latest summary date for this employee+entity
        SELECT MAX(date) INTO v_last_summary_date
        FROM public.timeclock_summaries
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date;

        -- If summary already covers yesterday, skip
        IF v_last_summary_date IS NOT NULL AND v_last_summary_date >= (v_today_local - 1) THEN
            CONTINUE;
        END IF;

        -- Recalculate: walk events from clock_in to now, split at TZ midnight
        -- Delete stale summaries for this session range
        DELETE FROM public.timeclock_summaries
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date
          AND date < v_today_local; -- Don't touch today (FE derives today from events)

        -- Replay events up to midnight of today (not including today)
        DECLARE
            ev RECORD;
            v_last_type TEXT := 'clock_in';
            v_last_at TIMESTAMPTZ := v_clock_in_at;
            v_cutoff TIMESTAMPTZ := (v_today_local::timestamp AT TIME ZONE v_tz); -- midnight today local
        BEGIN
            FOR ev IN
                SELECT event_type, created_at
                FROM public.timeclock_events
                WHERE employee_id = r.employee_id
                  AND entity_id = r.entity_id
                  AND created_at > v_clock_in_at
                  AND created_at < v_cutoff
                ORDER BY created_at ASC
            LOOP
                IF ev.event_type = 'lunch_start' AND v_last_type IN ('clock_in', 'lunch_end') THEN
                    PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'work');
                    v_last_type := 'lunch_start'; v_last_at := ev.created_at;
                ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                    PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'break');
                    v_last_type := 'lunch_end'; v_last_at := ev.created_at;
                END IF;
            END LOOP;

            -- Add remaining segment up to cutoff (midnight today)
            IF v_last_type IN ('clock_in', 'lunch_end') AND v_last_at < v_cutoff THEN
                PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, v_cutoff, 'work');
            ELSIF v_last_type = 'lunch_start' AND v_last_at < v_cutoff THEN
                PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, v_cutoff, 'break');
            END IF;
        END;
    END LOOP;
END;
$$;

-- Schedule the cron job (requires pg_cron extension)
SELECT cron.schedule(
    'timeclock-overnight-splits',
    '0 * * * *', -- every hour at :00
    $$SELECT public.timeclock_cron_overnight_splits()$$
);

-- PHASE 5: Re-backfill with timezone-aware midnight splits
-- Clear old UTC-based summaries and recalculate everything
TRUNCATE public.timeclock_summaries;

DO $$
DECLARE
    r RECORD;
    v_tz TEXT;
    v_clock_in_at TIMESTAMPTZ;
    ev RECORD;
    v_last_type TEXT;
    v_last_at TIMESTAMPTZ;
BEGIN
    -- Process each closed session (clock_in → clock_out pair)
    FOR r IN
        SELECT employee_id, entity_id, created_at as clock_out_at,
               (SELECT timezone::text FROM entities WHERE id = te.entity_id) as tz
        FROM public.timeclock_events te
        WHERE event_type = 'clock_out'
        ORDER BY employee_id, entity_id, created_at
    LOOP
        v_tz := COALESCE(r.tz, 'UTC');

        -- Find matching clock_in
        SELECT created_at INTO v_clock_in_at
        FROM public.timeclock_events
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND event_type = 'clock_in'
          AND created_at < r.clock_out_at
          AND NOT EXISTS (
              SELECT 1 FROM public.timeclock_events co
              WHERE co.employee_id = r.employee_id
                AND co.entity_id = r.entity_id
                AND co.event_type = 'clock_out'
                AND co.created_at > timeclock_events.created_at
                AND co.created_at < r.clock_out_at
          )
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_clock_in_at IS NULL THEN CONTINUE; END IF;

        v_last_type := 'clock_in';
        v_last_at := v_clock_in_at;

        FOR ev IN
            SELECT event_type, created_at
            FROM public.timeclock_events
            WHERE employee_id = r.employee_id
              AND entity_id = r.entity_id
              AND created_at > v_clock_in_at
              AND created_at <= r.clock_out_at
            ORDER BY created_at ASC
        LOOP
            IF ev.event_type = 'lunch_start' AND v_last_type IN ('clock_in', 'lunch_end') THEN
                PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'work');
                v_last_type := 'lunch_start'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'break');
                v_last_type := 'lunch_end'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'clock_out' THEN
                IF v_last_type IN ('clock_in', 'lunch_end') THEN
                    PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'work');
                ELSIF v_last_type = 'lunch_start' THEN
                    PERFORM _timeclock_add_segment(r.employee_id, r.entity_id, v_tz, v_last_at, ev.created_at, 'break');
                END IF;
                v_last_type := 'clock_out'; v_last_at := ev.created_at;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;
