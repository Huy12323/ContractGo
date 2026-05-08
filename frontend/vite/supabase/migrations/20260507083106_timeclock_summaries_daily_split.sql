-- ============================================
-- Restructure timeclock_summaries: per-session → per-date
-- Sessions split at midnight, one row per employee+entity+date
-- ============================================

-- PHASE 1: Drop old table + triggers (table before enum due to dependency)
DROP TRIGGER IF EXISTS trigger_timeclock_events_update_summary ON public.timeclock_events;
DROP TRIGGER IF EXISTS trigger_set_org_id_timeclock_summaries ON public.timeclock_summaries;
DROP TRIGGER IF EXISTS trg_notify_realtime_timeclock_summaries ON public.timeclock_summaries;
DROP FUNCTION IF EXISTS public.timeclock_events_update_summary();
DROP TABLE IF EXISTS public.timeclock_summaries;
DROP TYPE IF EXISTS public.timeclock_summary_status_enum;

-- PHASE 2: Recreate table — one row per employee+entity+date
CREATE TABLE public.timeclock_summaries (
    id TEXT PRIMARY KEY DEFAULT generate_id('tcs'),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    worked_ms BIGINT NOT NULL DEFAULT 0,
    break_ms BIGINT NOT NULL DEFAULT 0,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, entity_id, date)
);

CREATE INDEX idx_timeclock_summaries_employee_id ON public.timeclock_summaries(employee_id);
CREATE INDEX idx_timeclock_summaries_entity_id ON public.timeclock_summaries(entity_id);
CREATE INDEX idx_timeclock_summaries_organization_id ON public.timeclock_summaries(organization_id);
CREATE INDEX idx_timeclock_summaries_date ON public.timeclock_summaries(date);
CREATE INDEX idx_timeclock_summaries_entity_date ON public.timeclock_summaries(entity_id, date);

-- PHASE 3: Org ID trigger
CREATE TRIGGER trigger_set_org_id_timeclock_summaries
    BEFORE INSERT ON public.timeclock_summaries
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_employee();

-- PHASE 4: RLS
ALTER TABLE public.timeclock_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_timeclock_summaries"
    ON public.timeclock_summaries FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_timeclock_summaries"
    ON public.timeclock_summaries FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_view_own_timeclock_summaries"
    ON public.timeclock_summaries FOR SELECT TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- PHASE 5: Realtime trigger
CREATE TRIGGER trg_notify_realtime_timeclock_summaries
    AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_summaries
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

-- PHASE 6: Recalculation function
-- Given an employee+entity, recalculates ALL daily summaries from raw events.
-- Handles midnight splits: a session from 22:00 to 06:00 produces two daily rows.
CREATE OR REPLACE FUNCTION public.timeclock_recalc_daily_summaries(
    p_employee_id TEXT,
    p_entity_id TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
    v_last_type TEXT;
    v_last_at TIMESTAMPTZ;
    v_seg_start TIMESTAMPTZ;
    v_seg_end TIMESTAMPTZ;
    v_seg_type TEXT; -- 'work' or 'break'
    v_day DATE;
    v_midnight TIMESTAMPTZ;
    v_ms BIGINT;
BEGIN
    -- Clear existing summaries for this employee+entity
    DELETE FROM public.timeclock_summaries
    WHERE employee_id = p_employee_id AND entity_id = p_entity_id;

    v_last_type := NULL;
    v_last_at := NULL;

    FOR r IN
        SELECT event_type, created_at
        FROM public.timeclock_events
        WHERE employee_id = p_employee_id AND entity_id = p_entity_id
        ORDER BY created_at ASC
    LOOP
        IF r.event_type = 'clock_in' THEN
            v_last_type := 'clock_in';
            v_last_at := r.created_at;

        ELSIF r.event_type = 'lunch_start' AND v_last_type IN ('clock_in', 'lunch_end') THEN
            -- Work segment: v_last_at → r.created_at
            v_seg_start := v_last_at;
            v_seg_end := r.created_at;
            v_seg_type := 'work';

            -- Split at midnight boundaries
            WHILE v_seg_start < v_seg_end LOOP
                v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
                v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
                IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

                v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
                VALUES (p_employee_id, p_entity_id, v_day, v_ms, 0)
                ON CONFLICT (employee_id, entity_id, date)
                DO UPDATE SET worked_ms = timeclock_summaries.worked_ms + v_ms, updated_at = now();

                v_seg_start := v_midnight;
            END LOOP;

            v_last_type := 'lunch_start';
            v_last_at := r.created_at;

        ELSIF r.event_type = 'lunch_end' AND v_last_type = 'lunch_start' THEN
            -- Break segment: v_last_at → r.created_at
            v_seg_start := v_last_at;
            v_seg_end := r.created_at;

            WHILE v_seg_start < v_seg_end LOOP
                v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
                v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
                IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

                v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
                VALUES (p_employee_id, p_entity_id, v_day, 0, v_ms)
                ON CONFLICT (employee_id, entity_id, date)
                DO UPDATE SET break_ms = timeclock_summaries.break_ms + v_ms, updated_at = now();

                v_seg_start := v_midnight;
            END LOOP;

            v_last_type := 'lunch_end';
            v_last_at := r.created_at;

        ELSIF r.event_type = 'clock_out' AND v_last_type IN ('clock_in', 'lunch_end') THEN
            -- Final work segment: v_last_at → r.created_at
            v_seg_start := v_last_at;
            v_seg_end := r.created_at;

            WHILE v_seg_start < v_seg_end LOOP
                v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
                v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
                IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

                v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
                VALUES (p_employee_id, p_entity_id, v_day, v_ms, 0)
                ON CONFLICT (employee_id, entity_id, date)
                DO UPDATE SET worked_ms = timeclock_summaries.worked_ms + v_ms, updated_at = now();

                v_seg_start := v_midnight;
            END LOOP;

            v_last_type := 'clock_out';
            v_last_at := r.created_at;

        ELSIF r.event_type = 'clock_out' AND v_last_type = 'lunch_start' THEN
            -- Clock out while on lunch — count as break
            v_seg_start := v_last_at;
            v_seg_end := r.created_at;

            WHILE v_seg_start < v_seg_end LOOP
                v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
                v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
                IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

                v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

                INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
                VALUES (p_employee_id, p_entity_id, v_day, 0, v_ms)
                ON CONFLICT (employee_id, entity_id, date)
                DO UPDATE SET break_ms = timeclock_summaries.break_ms + v_ms, updated_at = now();

                v_seg_start := v_midnight;
            END LOOP;

            v_last_type := 'clock_out';
            v_last_at := r.created_at;
        END IF;
    END LOOP;

    -- Handle open session (no clock_out yet): compute work up to NOW
    IF v_last_type IN ('clock_in', 'lunch_end') THEN
        v_seg_start := v_last_at;
        v_seg_end := now();

        WHILE v_seg_start < v_seg_end LOOP
            v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
            v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
            IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

            v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

            INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
            VALUES (p_employee_id, p_entity_id, v_day, v_ms, 0)
            ON CONFLICT (employee_id, entity_id, date)
            DO UPDATE SET worked_ms = timeclock_summaries.worked_ms + v_ms, updated_at = now();

            v_seg_start := v_midnight;
        END LOOP;
    ELSIF v_last_type = 'lunch_start' THEN
        v_seg_start := v_last_at;
        v_seg_end := now();

        WHILE v_seg_start < v_seg_end LOOP
            v_day := (v_seg_start AT TIME ZONE 'UTC')::date;
            v_midnight := (v_day + 1)::timestamp AT TIME ZONE 'UTC';
            IF v_midnight > v_seg_end THEN v_midnight := v_seg_end; END IF;

            v_ms := EXTRACT(EPOCH FROM (v_midnight - v_seg_start))::BIGINT * 1000;

            INSERT INTO public.timeclock_summaries (employee_id, entity_id, date, worked_ms, break_ms)
            VALUES (p_employee_id, p_entity_id, v_day, 0, v_ms)
            ON CONFLICT (employee_id, entity_id, date)
            DO UPDATE SET break_ms = timeclock_summaries.break_ms + v_ms, updated_at = now();

            v_seg_start := v_midnight;
        END LOOP;
    END IF;
END;
$$;

-- PHASE 7: Event trigger — recalc on every event insert
CREATE OR REPLACE FUNCTION public.timeclock_events_recalc_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.timeclock_recalc_daily_summaries(NEW.employee_id, NEW.entity_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_timeclock_events_recalc_summary
    AFTER INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.timeclock_events_recalc_trigger();

-- PHASE 8: Backfill all employees
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT employee_id, entity_id
        FROM public.timeclock_events
    LOOP
        PERFORM public.timeclock_recalc_daily_summaries(r.employee_id, r.entity_id);
    END LOOP;
END;
$$;
