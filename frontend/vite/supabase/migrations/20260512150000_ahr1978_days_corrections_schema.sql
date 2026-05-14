-- ============================================
-- AHR-1978: Days dimension table + correction tables + unified RPC
-- ============================================

-- ═══════════════════════════════════════════
-- PHASE A: Days dimension table + helper
-- ═══════════════════════════════════════════

CREATE TABLE public.days (
    id TEXT PRIMARY KEY DEFAULT generate_id('day'),
    date DATE NOT NULL,
    day SMALLINT GENERATED ALWAYS AS (EXTRACT(DAY FROM date)::smallint) STORED,
    month SMALLINT GENERATED ALWAYS AS (EXTRACT(MONTH FROM date)::smallint) STORED,
    year SMALLINT GENERATED ALWAYS AS (EXTRACT(YEAR FROM date)::smallint) STORED,
    timezone TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date, timezone)
);

CREATE INDEX idx_days_year_month ON public.days(year, month);

CREATE OR REPLACE FUNCTION public.get_or_create_day(p_date DATE, p_tz TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.days (date, timezone)
    VALUES (p_date, p_tz)
    ON CONFLICT (date, timezone) DO UPDATE SET date = EXCLUDED.date
    RETURNING id;
$$;

-- Days is a shared dimension — no org_id, no RLS.
-- Access control is enforced on the tables that FK to days (sessions, corrections).

-- ═══════════════════════════════════════════
-- PHASE B: day_id on timeclock_sessions
-- ═══════════════════════════════════════════

ALTER TABLE public.timeclock_sessions
    ADD COLUMN day_id TEXT REFERENCES public.days(id);

CREATE OR REPLACE FUNCTION public.set_day_id_for_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tz TEXT;
    v_local_date DATE;
BEGIN
    SELECT COALESCE(e.timezone::text, 'UTC') INTO v_tz
    FROM public.entities e
    WHERE e.id = NEW.entity_id;

    v_local_date := (NEW.start_at AT TIME ZONE v_tz)::date;
    NEW.day_id := public.get_or_create_day(v_local_date, v_tz);

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_day_id_timeclock_sessions
    BEFORE INSERT ON public.timeclock_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_day_id_for_session();

-- Backfill: create day rows for all existing sessions
INSERT INTO public.days (date, timezone)
SELECT DISTINCT
    (s.start_at AT TIME ZONE COALESCE(e.timezone::text, 'UTC'))::date,
    COALESCE(e.timezone::text, 'UTC')
FROM public.timeclock_sessions s
JOIN public.entities e ON e.id = s.entity_id
ON CONFLICT (date, timezone) DO NOTHING;

-- Backfill: assign day_id to existing sessions
UPDATE public.timeclock_sessions s
SET day_id = d.id
FROM public.entities e, public.days d
WHERE s.entity_id = e.id
  AND d.date = (s.start_at AT TIME ZONE COALESCE(e.timezone::text, 'UTC'))::date
  AND d.timezone = COALESCE(e.timezone::text, 'UTC')
  AND s.day_id IS NULL;

ALTER TABLE public.timeclock_sessions ALTER COLUMN day_id SET DEFAULT '';
ALTER TABLE public.timeclock_sessions ALTER COLUMN day_id SET NOT NULL;

CREATE INDEX idx_tcs_day_id ON public.timeclock_sessions(day_id);
CREATE INDEX idx_tcs_entity_day_id ON public.timeclock_sessions(entity_id, day_id);

-- ═══════════════════════════════════════════
-- PHASE C: Correction tables
-- ═══════════════════════════════════════════

CREATE TYPE public.correction_task_status_enum AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE public.correction_tasks (
    id TEXT PRIMARY KEY DEFAULT generate_id('ctk'),
    day_id TEXT NOT NULL REFERENCES public.days(id),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    status public.correction_task_status_enum NOT NULL DEFAULT 'pending',
    message TEXT,
    approved_by UUID REFERENCES public.profiles(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES public.profiles(id),
    rejected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_correction_tasks_day_id ON public.correction_tasks(day_id);
CREATE INDEX idx_correction_tasks_employee_id ON public.correction_tasks(employee_id);
CREATE INDEX idx_correction_tasks_entity_id ON public.correction_tasks(entity_id);
CREATE INDEX idx_correction_tasks_organization_id ON public.correction_tasks(organization_id);
CREATE INDEX idx_correction_tasks_status ON public.correction_tasks(status);

CREATE TRIGGER trigger_set_org_id_correction_tasks
    BEFORE INSERT ON public.correction_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_entity();

ALTER TABLE public.correction_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_correction_tasks"
    ON public.correction_tasks FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "admin_or_owner_can_update_correction_tasks"
    ON public.correction_tasks FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_correction_tasks"
    ON public.correction_tasks FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_insert_own_correction_tasks"
    ON public.correction_tasks FOR INSERT TO authenticated
    WITH CHECK (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- timeclock_corrections: child of correction_tasks

CREATE TABLE public.timeclock_corrections (
    id TEXT PRIMARY KEY DEFAULT generate_id('tcr'),
    correction_task_id TEXT NOT NULL REFERENCES public.correction_tasks(id) ON DELETE CASCADE,
    day_id TEXT NOT NULL REFERENCES public.days(id),
    session_id TEXT REFERENCES public.timeclock_sessions(id) ON DELETE SET NULL,
    type public.timeclock_session_type_enum NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tcr_correction_task_id ON public.timeclock_corrections(correction_task_id);
CREATE INDEX idx_tcr_day_id ON public.timeclock_corrections(day_id);
CREATE INDEX idx_tcr_session_id ON public.timeclock_corrections(session_id);
CREATE INDEX idx_tcr_organization_id ON public.timeclock_corrections(organization_id);

CREATE OR REPLACE FUNCTION public.set_org_id_from_correction_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.correction_tasks
    WHERE id = NEW.correction_task_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for correction_task_id %', NEW.correction_task_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_timeclock_corrections
    BEFORE INSERT ON public.timeclock_corrections
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_correction_task();

ALTER TABLE public.timeclock_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_timeclock_corrections"
    ON public.timeclock_corrections FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_timeclock_corrections"
    ON public.timeclock_corrections FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_timeclock_corrections"
    ON public.timeclock_corrections FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_view_own_timeclock_corrections"
    ON public.timeclock_corrections FOR SELECT TO authenticated
    USING (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE employee_id IN (
                SELECT id FROM public.employees
                WHERE user_id = (SELECT auth.uid())
            )
        )
    );

CREATE POLICY "employee_can_insert_own_timeclock_corrections"
    ON public.timeclock_corrections FOR INSERT TO authenticated
    WITH CHECK (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE employee_id IN (
                SELECT id FROM public.employees
                WHERE user_id = (SELECT auth.uid())
            )
        )
    );

-- ═══════════════════════════════════════════
-- PHASE D: Update get_timesheet_grid() RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_timesheet_grid(
    p_entity_id TEXT,
    p_start_utc TIMESTAMPTZ,
    p_end_utc TIMESTAMPTZ,
    p_timezone TEXT,
    p_employee_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE(employee_id TEXT, work_date DATE, worked_ms BIGINT, break_ms BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id TEXT;
    v_caller_id uuid;
    v_authorized boolean;
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    v_caller_id := COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid;

    SELECT e.organization_id INTO v_org_id
    FROM public.entities e
    WHERE e.id = p_entity_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Entity not found: %', p_entity_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.organizations
        WHERE id = v_org_id AND owner_id = v_caller_id
    ) OR EXISTS (
        SELECT 1 FROM public.admins
        WHERE organization_id = v_org_id AND user_id = v_caller_id
    ) INTO v_authorized;

    IF NOT v_authorized THEN
        RAISE EXCEPTION 'Forbidden — admin or owner role required';
    END IF;

    v_start_date := (p_start_utc AT TIME ZONE p_timezone)::date;
    v_end_date := (p_end_utc AT TIME ZONE p_timezone)::date;

    RETURN QUERY
    WITH day_ids AS (
        SELECT d.id AS day_id, d.date
        FROM public.days d
        WHERE d.timezone = p_timezone
          AND d.date >= v_start_date
          AND d.date <= v_end_date
    ),
    unified AS (
        SELECT
            s.employee_id,
            s.day_id,
            s.duration_ms,
            s.type
        FROM public.timeclock_sessions s
        WHERE s.entity_id = p_entity_id
          AND s.start_at >= p_start_utc
          AND s.start_at < p_end_utc
          AND s.end_at IS NOT NULL
          AND (p_employee_ids IS NULL OR s.employee_id = ANY(p_employee_ids))
          AND NOT EXISTS (
              SELECT 1 FROM public.timeclock_corrections c
              JOIN public.correction_tasks ct ON ct.id = c.correction_task_id
              WHERE c.session_id = s.id
                AND ct.status = 'approved'
          )

        UNION ALL

        SELECT
            ct.employee_id,
            c.day_id,
            c.duration_ms,
            c.type
        FROM public.timeclock_corrections c
        JOIN public.correction_tasks ct ON ct.id = c.correction_task_id
        WHERE ct.entity_id = p_entity_id
          AND ct.status = 'approved'
          AND c.day_id IN (SELECT di.day_id FROM day_ids di)
          AND (p_employee_ids IS NULL OR ct.employee_id = ANY(p_employee_ids))
    )
    SELECT
        u.employee_id,
        di.date,
        GREATEST(
            COALESCE(SUM(u.duration_ms) FILTER (WHERE u.type = 'work'), 0)
            - COALESCE(SUM(u.duration_ms) FILTER (WHERE u.type = 'break'), 0),
            0
        )::bigint,
        COALESCE(SUM(u.duration_ms) FILTER (WHERE u.type = 'break'), 0)::bigint
    FROM unified u
    JOIN day_ids di ON di.day_id = u.day_id
    GROUP BY u.employee_id, di.date;
END;
$$;
