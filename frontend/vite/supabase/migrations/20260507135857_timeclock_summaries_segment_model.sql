-- ============================================
-- Redesign timeclock_summaries: segment-based model
-- Each row = one work or break segment, with start_at + duration_ms + type + status
-- Multiple rows per employee per date (multiple sessions/breaks)
-- ============================================

-- PHASE 1: Drop old triggers + functions
DROP TRIGGER IF EXISTS trigger_timeclock_on_clock_out ON public.timeclock_events;
DROP TRIGGER IF EXISTS trigger_timeclock_events_recalc_summary ON public.timeclock_events;
DROP TRIGGER IF EXISTS trigger_set_timeclock_summary_metadata ON public.timeclock_summaries;
DROP TRIGGER IF EXISTS trg_notify_realtime_timeclock_summaries ON public.timeclock_summaries;
DROP FUNCTION IF EXISTS public.timeclock_on_clock_out();
DROP FUNCTION IF EXISTS public.timeclock_events_recalc_trigger();
DROP FUNCTION IF EXISTS public.timeclock_recalc_daily_summaries(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_timeclock_summary_metadata();
DROP FUNCTION IF EXISTS public._timeclock_split_at_midnight(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

-- PHASE 2: Drop and recreate table
DROP TABLE IF EXISTS public.timeclock_summaries;

CREATE TYPE public.timeclock_segment_type_enum AS ENUM ('work', 'break');
CREATE TYPE public.timeclock_segment_status_enum AS ENUM ('ongoing', 'closed');

CREATE TABLE public.timeclock_summaries (
    id TEXT PRIMARY KEY DEFAULT generate_id('tcs'),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    type public.timeclock_segment_type_enum NOT NULL,
    status public.timeclock_segment_status_enum NOT NULL DEFAULT 'closed',
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tcs_employee_id ON public.timeclock_summaries(employee_id);
CREATE INDEX idx_tcs_entity_id ON public.timeclock_summaries(entity_id);
CREATE INDEX idx_tcs_organization_id ON public.timeclock_summaries(organization_id);
CREATE INDEX idx_tcs_date ON public.timeclock_summaries(date);
CREATE INDEX idx_tcs_entity_date ON public.timeclock_summaries(entity_id, date);
CREATE INDEX idx_tcs_type ON public.timeclock_summaries(type);
CREATE INDEX idx_tcs_status ON public.timeclock_summaries(status);
CREATE INDEX idx_tcs_employee_date ON public.timeclock_summaries(employee_id, date);

-- PHASE 3: Metadata trigger (org_id + timezone from entity)
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

CREATE TRIGGER trigger_set_timeclock_summary_metadata
    BEFORE INSERT ON public.timeclock_summaries
    FOR EACH ROW
    EXECUTE FUNCTION public.set_timeclock_summary_metadata();

-- PHASE 4: RLS
ALTER TABLE public.timeclock_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_timeclock_summaries"
    ON public.timeclock_summaries FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_manage_timeclock_summaries"
    ON public.timeclock_summaries FOR ALL TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_view_own_timeclock_summaries"
    ON public.timeclock_summaries FOR SELECT TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- PHASE 5: Realtime
CREATE OR REPLACE FUNCTION public.get_organization_id_for_change(
    p_table_name TEXT,
    p_record_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    org_id TEXT;
BEGIN
    CASE p_table_name
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        WHEN 'entities', 'admins', 'employees', 'departments',
             'contract_templates', 'contracts',
             'employee_columns', 'employee_column_choices', 'employee_views',
             'onboarding_invitations', 'files', 'admin_invitations',
             'timeclock_events', 'timeclock_summaries' THEN
            org_id := p_record_data->>'organization_id';

        WHEN 'rel__department__employee' THEN
            SELECT d.organization_id INTO org_id
            FROM public.departments d
            WHERE d.id = p_record_data->>'department_id';

        WHEN 'rel__department__invitation' THEN
            SELECT oi.organization_id INTO org_id
            FROM public.onboarding_invitations oi
            WHERE oi.id = p_record_data->>'invitation_id';

        ELSE
            RAISE WARNING 'get_organization_id_for_change: unknown table %', p_table_name;
            RETURN NULL;
    END CASE;

    RETURN org_id;
END;
$$;

CREATE TRIGGER trg_notify_realtime_timeclock_summaries
    AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_summaries
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

-- PHASE 6: Midnight-split helper (returns segments split at TZ midnight)
CREATE OR REPLACE FUNCTION public._timeclock_split_at_midnight(
    p_tz TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_type public.timeclock_segment_type_enum
)
RETURNS TABLE(day DATE, seg_start TIMESTAMPTZ, seg_duration_ms BIGINT)
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
            day := v_day;
            seg_start := v_cursor;
            seg_duration_ms := v_ms;
            RETURN NEXT;
        END IF;

        v_cursor := v_seg_end;
    END LOOP;
END;
$$;

-- PHASE 7: Clock-out trigger — create closed segments for the completed session
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

    -- Delete any existing ongoing segments for this employee+entity (from cron)
    DELETE FROM public.timeclock_summaries
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND status = 'ongoing';

    -- Also delete closed segments from this session date range (idempotent recalc)
    DELETE FROM public.timeclock_summaries
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND date >= (v_clock_in_at AT TIME ZONE v_tz)::date
      AND date <= (NEW.created_at AT TIME ZONE v_tz)::date
      AND start_at >= v_clock_in_at
      AND start_at <= NEW.created_at;

    -- Walk events and create segments
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
            -- Work segment
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                VALUES (NEW.employee_id, NEW.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
            END LOOP;
            v_last_type := 'lunch_start'; v_last_at := ev.created_at;

        ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
            -- Break segment
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                VALUES (NEW.employee_id, NEW.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
            END LOOP;
            v_last_type := 'lunch_end'; v_last_at := ev.created_at;

        ELSIF ev.event_type = 'clock_out' THEN
            IF v_last_type IN ('clock_in', 'lunch_end') THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (NEW.employee_id, NEW.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
                END LOOP;
            ELSIF v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (NEW.employee_id, NEW.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
                END LOOP;
            END IF;
            v_last_type := 'clock_out'; v_last_at := ev.created_at;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_timeclock_on_clock_out
    AFTER INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.timeclock_on_clock_out();

-- PHASE 8: Cron job — handle overnight open sessions
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
    -- Find employees with open sessions
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

        -- Find session's clock_in
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

        -- Delete existing ongoing + past-day segments for this session
        DELETE FROM public.timeclock_summaries
        WHERE employee_id = r.employee_id
          AND entity_id = r.entity_id
          AND (status = 'ongoing' OR (date >= (v_clock_in_at AT TIME ZONE v_tz)::date AND date < v_today_local));

        -- Replay events up to midnight today, create closed segments for past days
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
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
                END LOOP;
                v_last_type := 'lunch_start'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
                END LOOP;
                v_last_type := 'lunch_end'; v_last_at := ev.created_at;
            END IF;
        END LOOP;

        -- Remaining segment up to cutoff (past days only)
        IF v_last_type IN ('clock_in', 'lunch_end') AND v_last_at < v_cutoff THEN
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, v_cutoff, 'work') LOOP
                IF seg.day < v_today_local THEN
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
                END IF;
            END LOOP;
        ELSIF v_last_type = 'lunch_start' AND v_last_at < v_cutoff THEN
            FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, v_cutoff, 'break') LOOP
                IF seg.day < v_today_local THEN
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
                END IF;
            END LOOP;
        END IF;

        -- Create an ongoing segment for today
        IF v_last_at < v_cutoff THEN
            v_last_at := v_cutoff;
        END IF;
        IF v_last_type IN ('clock_in', 'lunch_end') THEN
            INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
            VALUES (r.employee_id, r.entity_id, v_today_local, v_last_at,
                    EXTRACT(EPOCH FROM (now() - v_last_at))::BIGINT * 1000, 'work', 'ongoing');
        ELSIF v_last_type = 'lunch_start' THEN
            INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
            VALUES (r.employee_id, r.entity_id, v_today_local, v_last_at,
                    EXTRACT(EPOCH FROM (now() - v_last_at))::BIGINT * 1000, 'break', 'ongoing');
        END IF;
    END LOOP;
END;
$$;

-- Re-schedule cron
SELECT cron.unschedule('timeclock-overnight-splits');
SELECT cron.schedule(
    'timeclock-overnight-splits',
    '0 * * * *',
    $$SELECT public.timeclock_cron_overnight_splits()$$
);

-- PHASE 9: Backfill from existing events (closed sessions only)
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
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
                END LOOP;
                v_last_type := 'lunch_start'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
                FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                    INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                    VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
                END LOOP;
                v_last_type := 'lunch_end'; v_last_at := ev.created_at;
            ELSIF ev.event_type = 'clock_out' THEN
                IF v_last_type IN ('clock_in', 'lunch_end') THEN
                    FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'work') LOOP
                        INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                        VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'work', 'closed');
                    END LOOP;
                ELSIF v_last_type = 'lunch_start' THEN
                    FOR seg IN SELECT * FROM _timeclock_split_at_midnight(v_tz, v_last_at, ev.created_at, 'break') LOOP
                        INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, start_at, duration_ms, type, status)
                        VALUES (r.employee_id, r.entity_id, seg.day, seg.seg_start, seg.seg_duration_ms, 'break', 'closed');
                    END LOOP;
                END IF;
                v_last_type := 'clock_out'; v_last_at := ev.created_at;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;
