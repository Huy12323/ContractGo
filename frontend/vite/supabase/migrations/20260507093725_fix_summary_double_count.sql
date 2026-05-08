-- ============================================
-- Fix double-counting: rewrite _timeclock_add_segment and
-- timeclock_on_clock_out to accumulate in-memory then INSERT once per day
-- ============================================

-- Drop old helper
DROP FUNCTION IF EXISTS public._timeclock_add_segment(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- New helper: splits a segment at TZ midnight and returns rows via SETOF
CREATE OR REPLACE FUNCTION public._timeclock_split_at_midnight(
    p_tz TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_type TEXT
)
RETURNS TABLE(day DATE, worked_ms BIGINT, break_ms BIGINT)
LANGUAGE plpgsql
IMMUTABLE
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
        v_seg_end := LEAST(v_next_midnight, p_end);
        v_ms := EXTRACT(EPOCH FROM (v_seg_end - v_cursor))::BIGINT * 1000;

        IF v_ms > 0 THEN
            IF p_type = 'work' THEN
                day := v_day; worked_ms := v_ms; break_ms := 0;
            ELSE
                day := v_day; worked_ms := 0; break_ms := v_ms;
            END IF;
            RETURN NEXT;
        END IF;

        v_cursor := v_seg_end;
    END LOOP;
END;
$$;

-- Rewrite clock_out trigger: accumulate via temp table, INSERT once per day
CREATE OR REPLACE FUNCTION public.timeclock_on_clock_out()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz TEXT;
    v_clock_in_at TIMESTAMPTZ;
    v_last_type TEXT;
    v_last_at TIMESTAMPTZ;
    ev RECORD;
    seg RECORD;
BEGIN
    IF NEW.event_type != 'clock_out' THEN
        RETURN NEW;
    END IF;

    v_tz := COALESCE(NEW.timezone, 'UTC');

    -- Find the clock_in that starts this session
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

    -- Build per-day totals using a temp table
    CREATE TEMP TABLE IF NOT EXISTS _tc_day_totals (
        day DATE PRIMARY KEY,
        worked_ms BIGINT DEFAULT 0,
        break_ms BIGINT DEFAULT 0
    ) ON COMMIT DROP;
    TRUNCATE _tc_day_totals;

    -- Walk events and split segments at TZ midnight
    v_last_type := 'clock_in';
    v_last_at := v_clock_in_at;

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
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                INSERT INTO _tc_day_totals (day, worked_ms, break_ms) VALUES (seg.day, seg.worked_ms, 0)
                ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
            END LOOP;
            v_last_type := 'lunch_start'; v_last_at := ev.created_at;

        ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                INSERT INTO _tc_day_totals (day, worked_ms, break_ms) VALUES (seg.day, 0, seg.break_ms)
                ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
            END LOOP;
            v_last_type := 'lunch_end'; v_last_at := ev.created_at;

        ELSIF ev.event_type = 'clock_out' THEN
            IF v_last_type IN ('clock_in', 'lunch_end') THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                    INSERT INTO _tc_day_totals (day, worked_ms, break_ms) VALUES (seg.day, seg.worked_ms, 0)
                    ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
                END LOOP;
            ELSIF v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO _tc_day_totals (day, worked_ms, break_ms) VALUES (seg.day, 0, seg.break_ms)
                    ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
                END LOOP;
            END IF;
            v_last_type := 'clock_out'; v_last_at := ev.created_at;
        END IF;
    END LOOP;

    -- Delete old summaries for this session's date range
    DELETE FROM public.timeclock_summaries
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date
      AND date <= (NEW.created_at AT TIME ZONE v_tz)::date;

    -- Insert one row per day from accumulated totals
    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
    SELECT NEW.employee_id, NEW.entity_id, t.day, t.worked_ms, t.break_ms
    FROM _tc_day_totals t
    WHERE t.worked_ms > 0 OR t.break_ms > 0;

    RETURN NEW;
END;
$$;

-- Also rewrite cron overnight function to use the same pattern
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
    v_today_local DATE;
    v_cutoff TIMESTAMPTZ;
    v_last_type TEXT;
    v_last_at TIMESTAMPTZ;
    ev RECORD;
    seg RECORD;
BEGIN
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

        SELECT created_at INTO v_clock_in_at
        FROM public.timeclock_events
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND event_type = 'clock_in'
          AND created_at <= r.created_at
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_clock_in_at IS NULL THEN CONTINUE; END IF;
        IF (v_clock_in_at AT TIME ZONE v_tz)::date >= v_today_local THEN CONTINUE; END IF;

        v_cutoff := (v_today_local::timestamp AT TIME ZONE v_tz);

        -- Delete stale summaries for past days of this session
        DELETE FROM public.timeclock_summaries
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date
          AND date < v_today_local;

        -- Accumulate
        CREATE TEMP TABLE IF NOT EXISTS _tc_day_totals (
            day DATE PRIMARY KEY,
            worked_ms BIGINT DEFAULT 0,
            break_ms BIGINT DEFAULT 0
        ) ON COMMIT DROP;
        TRUNCATE _tc_day_totals;

        v_last_type := 'clock_in';
        v_last_at := v_clock_in_at;

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
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                    INSERT INTO _tc_day_totals VALUES (seg.day, seg.worked_ms, 0) ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
                END LOOP;
                v_last_type := 'lunch_start'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO _tc_day_totals VALUES (seg.day, 0, seg.break_ms) ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
                END LOOP;
                v_last_type := 'lunch_end'; v_last_at := ev.created_at;
            END IF;
        END LOOP;

        -- Remaining segment up to cutoff
        IF v_last_type IN ('clock_in', 'lunch_end') AND v_last_at < v_cutoff THEN
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, v_cutoff, 'work') LOOP
                INSERT INTO _tc_day_totals VALUES (seg.day, seg.worked_ms, 0) ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
            END LOOP;
        ELSIF v_last_type = 'lunch_start' AND v_last_at < v_cutoff THEN
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, v_cutoff, 'break') LOOP
                INSERT INTO _tc_day_totals VALUES (seg.day, 0, seg.break_ms) ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
            END LOOP;
        END IF;

        -- Insert past-day summaries only (not today)
        INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
        SELECT r.employee_id, r.entity_id, t.day, t.worked_ms, t.break_ms
        FROM _tc_day_totals t
        WHERE t.day < v_today_local AND (t.worked_ms > 0 OR t.break_ms > 0);
    END LOOP;
END;
$$;

-- Re-backfill: truncate and replay all closed sessions
TRUNCATE public.timeclock_summaries;

DO $$
DECLARE
    r RECORD;
    v_tz TEXT;
    v_clock_in_at TIMESTAMPTZ;
    v_last_type TEXT;
    v_last_at TIMESTAMPTZ;
    ev RECORD;
    seg RECORD;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS _tc_day_totals (
        day DATE PRIMARY KEY,
        worked_ms BIGINT DEFAULT 0,
        break_ms BIGINT DEFAULT 0
    ) ON COMMIT DROP;

    FOR r IN
        SELECT te.employee_id, te.entity_id, te.created_at as clock_out_at,
               COALESCE((SELECT timezone::text FROM entities WHERE id = te.entity_id), 'UTC') as tz
        FROM public.timeclock_events te
        WHERE te.event_type = 'clock_out'
        ORDER BY te.employee_id, te.entity_id, te.created_at
    LOOP
        v_tz := r.tz;

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

        TRUNCATE _tc_day_totals;

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
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                    INSERT INTO _tc_day_totals VALUES (seg.day, seg.worked_ms, 0) ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
                END LOOP;
                v_last_type := 'lunch_start'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO _tc_day_totals VALUES (seg.day, 0, seg.break_ms) ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
                END LOOP;
                v_last_type := 'lunch_end'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'clock_out' THEN
                IF v_last_type IN ('clock_in', 'lunch_end') THEN
                    FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                        INSERT INTO _tc_day_totals VALUES (seg.day, seg.worked_ms, 0) ON CONFLICT (day) DO UPDATE SET worked_ms = _tc_day_totals.worked_ms + seg.worked_ms;
                    END LOOP;
                ELSIF v_last_type = 'lunch_start' THEN
                    FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                        INSERT INTO _tc_day_totals VALUES (seg.day, 0, seg.break_ms) ON CONFLICT (day) DO UPDATE SET break_ms = _tc_day_totals.break_ms + seg.break_ms;
                    END LOOP;
                END IF;
                v_last_type := 'clock_out'; v_last_at := ev.created_at;
            END IF;
        END LOOP;

        INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
        SELECT r.employee_id, r.entity_id, t.day, t.worked_ms, t.break_ms
        FROM _tc_day_totals t
        WHERE t.worked_ms > 0 OR t.break_ms > 0;
    END LOOP;
END;
$$;
