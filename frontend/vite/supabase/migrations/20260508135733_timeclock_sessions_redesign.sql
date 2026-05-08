-- ============================================
-- Timeclock session model redesign
-- Replace event-pairing + summaries with layered sessions table
-- Work session spans full shift, break sessions overlay within it
-- No summary table — RPC aggregates sessions server-side
-- ============================================

-- ═══════════════════════════════════════════
-- PHASE 1: Drop old summaries infrastructure
-- ═══════════════════════════════════════════

-- 1a: Unschedule cron
SELECT cron.unschedule('timeclock-overnight-splits');

-- 1b: Drop triggers on timeclock_events (summary-related only)
DROP TRIGGER IF EXISTS trigger_timeclock_on_clock_out ON public.timeclock_events;

-- 1c: Drop triggers on timeclock_summaries
DROP TRIGGER IF EXISTS trigger_set_timeclock_summary_metadata ON public.timeclock_summaries;
DROP TRIGGER IF EXISTS trg_notify_realtime_timeclock_summaries ON public.timeclock_summaries;

-- 1d: Drop functions
DROP FUNCTION IF EXISTS public.timeclock_on_clock_out();
DROP FUNCTION IF EXISTS public.set_timeclock_summary_metadata();
DROP FUNCTION IF EXISTS public._timeclock_split_at_midnight(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, public.timeclock_segment_type_enum);
DROP FUNCTION IF EXISTS public._timeclock_add_segment(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.timeclock_cron_overnight_splits();
DROP FUNCTION IF EXISTS public.timeclock_events_update_summary();
DROP FUNCTION IF EXISTS public.timeclock_events_recalc_trigger();
DROP FUNCTION IF EXISTS public.timeclock_recalc_daily_summaries(TEXT, TEXT);

-- 1e: Drop timeclock_summaries table
DROP TABLE IF EXISTS public.timeclock_summaries;

-- 1f: Drop unused enums
DROP TYPE IF EXISTS public.timeclock_segment_status_enum;
DROP TYPE IF EXISTS public.timeclock_segment_type_enum;
DROP TYPE IF EXISTS public.timeclock_summary_status_enum;


-- ═══════════════════════════════════════════
-- PHASE 2: Create new enums + table
-- ═══════════════════════════════════════════

CREATE TYPE public.timeclock_session_type_enum AS ENUM ('work', 'break');
CREATE TYPE public.timeclock_actor_enum AS ENUM ('employee', 'system');

CREATE TABLE public.timeclock_sessions (
    id TEXT PRIMARY KEY DEFAULT generate_id('tcs'),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    type public.timeclock_session_type_enum NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    duration_ms BIGINT,
    start_by public.timeclock_actor_enum NOT NULL DEFAULT 'employee',
    end_by public.timeclock_actor_enum,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ═══════════════════════════════════════════
-- PHASE 3: Indexes
-- ═══════════════════════════════════════════

CREATE INDEX idx_tcs_entity_start ON public.timeclock_sessions(entity_id, start_at);
CREATE INDEX idx_tcs_employee_start ON public.timeclock_sessions(employee_id, start_at);
CREATE INDEX idx_tcs_organization_id ON public.timeclock_sessions(organization_id);
CREATE INDEX idx_tcs_open_sessions ON public.timeclock_sessions(employee_id, entity_id)
    WHERE end_at IS NULL;


-- ═══════════════════════════════════════════
-- PHASE 4: Triggers
-- ═══════════════════════════════════════════

-- 4a: Org ID from employee (reuse existing function)
CREATE TRIGGER trigger_set_org_id_timeclock_sessions
    BEFORE INSERT ON public.timeclock_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_employee();

-- 4b: Per-org constraint — no open work session in another entity
CREATE OR REPLACE FUNCTION public.check_timeclock_session_per_org_constraint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_org_id TEXT;
    v_open_in_other BOOLEAN;
BEGIN
    IF NEW.type != 'work' OR NEW.end_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT user_id, organization_id INTO v_user_id, v_org_id
    FROM public.employees WHERE id = NEW.employee_id;

    SELECT EXISTS (
        SELECT 1
        FROM public.timeclock_sessions ts
        JOIN public.employees e ON e.id = ts.employee_id
        WHERE e.user_id = v_user_id
          AND e.organization_id = v_org_id
          AND ts.entity_id != NEW.entity_id
          AND ts.type = 'work'
          AND ts.end_at IS NULL
    ) INTO v_open_in_other;

    IF v_open_in_other THEN
        RAISE EXCEPTION 'Must clock out of current entity before clocking into another entity in the same organization';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_check_session_per_org_constraint
    BEFORE INSERT ON public.timeclock_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.check_timeclock_session_per_org_constraint();


-- ═══════════════════════════════════════════
-- PHASE 5: RLS
-- ═══════════════════════════════════════════

ALTER TABLE public.timeclock_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_timeclock_sessions"
    ON public.timeclock_sessions FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_timeclock_sessions"
    ON public.timeclock_sessions FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_timeclock_sessions"
    ON public.timeclock_sessions FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_timeclock_sessions"
    ON public.timeclock_sessions FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_view_own_timeclock_sessions"
    ON public.timeclock_sessions FOR SELECT TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "employee_can_insert_own_timeclock_sessions"
    ON public.timeclock_sessions FOR INSERT TO authenticated
    WITH CHECK (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "employee_can_update_own_timeclock_sessions"
    ON public.timeclock_sessions FOR UPDATE TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );


-- ═══════════════════════════════════════════
-- PHASE 6: Realtime
-- ═══════════════════════════════════════════

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
             'timeclock_events', 'timeclock_sessions' THEN
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

CREATE TRIGGER trg_notify_realtime_timeclock_sessions
    AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_sessions
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();


-- ═══════════════════════════════════════════
-- PHASE 7: RPC — server-side grid aggregation
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_timesheet_grid(
    p_entity_id TEXT,
    p_start_utc TIMESTAMPTZ,
    p_end_utc TIMESTAMPTZ,
    p_timezone TEXT
)
RETURNS TABLE(employee_id TEXT, work_date DATE, worked_ms BIGINT, break_ms BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT
        s.employee_id,
        (s.start_at AT TIME ZONE p_timezone)::date,
        GREATEST(
            COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'work'), 0)
            - COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'break'), 0),
            0
        ),
        COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'break'), 0)
    FROM public.timeclock_sessions s
    WHERE s.entity_id = p_entity_id
        AND s.start_at >= p_start_utc
        AND s.start_at < p_end_utc
        AND s.end_at IS NOT NULL
    GROUP BY s.employee_id, (s.start_at AT TIME ZONE p_timezone)::date
$$;


-- ═══════════════════════════════════════════
-- PHASE 8: Cron — midnight split processor
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.timeclock_process_midnight()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
    v_tz TEXT;
    v_today_local DATE;
    v_start_date DATE;
    v_cursor_date DATE;
    v_midnight TIMESTAMPTZ;
    v_day_start TIMESTAMPTZ;
    v_day_end TIMESTAMPTZ;
BEGIN
    FOR r IN
        SELECT s.id, s.employee_id, s.entity_id, s.type, s.start_at,
               COALESCE(e.timezone::text, 'UTC') as tz
        FROM public.timeclock_sessions s
        JOIN public.entities e ON e.id = s.entity_id
        WHERE s.end_at IS NULL
    LOOP
        v_tz := r.tz;
        v_today_local := (now() AT TIME ZONE v_tz)::date;
        v_start_date := (r.start_at AT TIME ZONE v_tz)::date;

        IF v_start_date >= v_today_local THEN
            CONTINUE;
        END IF;

        -- Close original session at next midnight after its start
        v_midnight := ((v_start_date + 1)::timestamp AT TIME ZONE v_tz);

        UPDATE public.timeclock_sessions
        SET end_at = v_midnight,
            duration_ms = EXTRACT(EPOCH FROM (v_midnight - start_at))::BIGINT * 1000,
            end_by = 'system',
            updated_at = now()
        WHERE id = r.id;

        -- Create closed sessions for each full day in between
        v_cursor_date := v_start_date + 1;
        WHILE v_cursor_date < v_today_local LOOP
            v_day_start := (v_cursor_date::timestamp AT TIME ZONE v_tz);
            v_day_end := ((v_cursor_date + 1)::timestamp AT TIME ZONE v_tz);

            INSERT INTO public.timeclock_sessions (
                employee_id, entity_id, type,
                start_at, end_at, duration_ms,
                start_by, end_by
            ) VALUES (
                r.employee_id, r.entity_id, r.type,
                v_day_start, v_day_end,
                EXTRACT(EPOCH FROM (v_day_end - v_day_start))::BIGINT * 1000,
                'system', 'system'
            );

            v_cursor_date := v_cursor_date + 1;
        END LOOP;

        -- Open new session for today
        v_day_start := (v_today_local::timestamp AT TIME ZONE v_tz);
        INSERT INTO public.timeclock_sessions (
            employee_id, entity_id, type,
            start_at, start_by
        ) VALUES (
            r.employee_id, r.entity_id, r.type,
            v_day_start, 'system'
        );
    END LOOP;
END;
$$;

SELECT cron.schedule(
    'timeclock-process-midnight',
    '*/15 * * * *',
    $$SELECT public.timeclock_process_midnight()$$
);


-- ═══════════════════════════════════════════
-- PHASE 9: Backfill helper + backfill from events
-- ═══════════════════════════════════════════

-- Helper: insert session(s) split at timezone midnight boundaries
CREATE OR REPLACE FUNCTION public._backfill_split_session(
    p_employee_id TEXT,
    p_entity_id TEXT,
    p_tz TEXT,
    p_type public.timeclock_session_type_enum,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_start_by public.timeclock_actor_enum,
    p_end_by public.timeclock_actor_enum
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
    v_dur BIGINT;
    v_s_by public.timeclock_actor_enum;
    v_e_by public.timeclock_actor_enum;
BEGIN
    WHILE v_cursor < p_end LOOP
        v_day := (v_cursor AT TIME ZONE p_tz)::date;
        v_next_midnight := ((v_day + 1)::timestamp AT TIME ZONE p_tz);
        v_seg_end := LEAST(v_next_midnight, p_end);
        v_dur := EXTRACT(EPOCH FROM (v_seg_end - v_cursor))::BIGINT * 1000;

        v_s_by := CASE WHEN v_cursor = p_start THEN p_start_by ELSE 'system' END;
        v_e_by := CASE WHEN v_seg_end = p_end THEN p_end_by ELSE 'system' END;

        IF v_dur > 0 THEN
            INSERT INTO public.timeclock_sessions (
                employee_id, entity_id, type,
                start_at, end_at, duration_ms,
                start_by, end_by
            ) VALUES (
                p_employee_id, p_entity_id, p_type,
                v_cursor, v_seg_end, v_dur,
                v_s_by, v_e_by
            );
        END IF;

        v_cursor := v_seg_end;
    END LOOP;
END;
$$;

-- Backfill: convert events → layered sessions
DO $$
DECLARE
    r RECORD;
    v_tz TEXT;
    v_work_start TIMESTAMPTZ;
    v_break_start TIMESTAMPTZ;
    v_last_employee TEXT := '';
    v_last_entity TEXT := '';
BEGIN
    FOR r IN
        SELECT employee_id, entity_id, event_type::text, created_at,
               COALESCE(timezone, 'UTC') as tz
        FROM public.timeclock_events
        ORDER BY employee_id, entity_id, created_at
    LOOP
        IF r.employee_id != v_last_employee OR r.entity_id != v_last_entity THEN
            v_work_start := NULL;
            v_break_start := NULL;
            v_last_employee := r.employee_id;
            v_last_entity := r.entity_id;
            v_tz := r.tz;
        END IF;

        CASE r.event_type
            WHEN 'clock_in' THEN
                v_work_start := r.created_at;

            WHEN 'lunch_start' THEN
                v_break_start := r.created_at;

            WHEN 'lunch_end' THEN
                IF v_break_start IS NOT NULL THEN
                    PERFORM public._backfill_split_session(
                        r.employee_id, r.entity_id, v_tz,
                        'break', v_break_start, r.created_at,
                        'employee', 'employee'
                    );
                    v_break_start := NULL;
                END IF;

            WHEN 'clock_out' THEN
                IF v_work_start IS NOT NULL THEN
                    PERFORM public._backfill_split_session(
                        r.employee_id, r.entity_id, v_tz,
                        'work', v_work_start, r.created_at,
                        'employee', 'employee'
                    );
                    v_work_start := NULL;
                END IF;
        END CASE;
    END LOOP;
END;
$$;

-- Drop the backfill helper (not needed at runtime)
DROP FUNCTION IF EXISTS public._backfill_split_session(TEXT, TEXT, TEXT, public.timeclock_session_type_enum, TIMESTAMPTZ, TIMESTAMPTZ, public.timeclock_actor_enum, public.timeclock_actor_enum);


-- ═══════════════════════════════════════════
-- PHASE 10: Clean up old event triggers (keep table for history)
-- ═══════════════════════════════════════════

DROP TRIGGER IF EXISTS trigger_check_timeclock_per_org_constraint ON public.timeclock_events;
DROP FUNCTION IF EXISTS public.check_timeclock_per_org_constraint();
