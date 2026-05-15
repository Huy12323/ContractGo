-- ============================================
-- AHR-1980: Fix get_timesheet_grid to use only the latest approved correction per employee+day
-- Bug: multiple approved corrections on the same day caused all their correction rows
-- to be unioned together, massively overcounting worked hours.
-- Fix: select only the most recently approved correction_task per employee+day_id.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_timesheet_grid(
    p_entity_id text,
    p_start_utc timestamp with time zone,
    p_end_utc timestamp with time zone,
    p_timezone text,
    p_employee_ids text[] DEFAULT NULL
)
RETURNS TABLE(employee_id text, work_date date, worked_ms bigint, break_ms bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    -- Latest approved correction per employee+day
    latest_approved AS (
        SELECT DISTINCT ON (ct.employee_id, ct.day_id)
            ct.id AS task_id,
            ct.employee_id,
            ct.day_id
        FROM public.correction_tasks ct
        WHERE ct.entity_id = p_entity_id
          AND ct.status = 'approved'
          AND ct.day_id IN (SELECT di.day_id FROM day_ids di)
          AND (p_employee_ids IS NULL OR ct.employee_id = ANY(p_employee_ids))
        ORDER BY ct.employee_id, ct.day_id, ct.admin_decided_at DESC NULLS LAST, ct.updated_at DESC
    ),
    -- Days that have an approved correction (to exclude original sessions)
    corrected_days AS (
        SELECT la.employee_id, la.day_id
        FROM latest_approved la
    ),
    unified AS (
        -- Original sessions for days WITHOUT approved corrections
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
              SELECT 1 FROM corrected_days cd
              WHERE cd.employee_id = s.employee_id AND cd.day_id = s.day_id
          )

        UNION ALL

        -- Correction rows from the latest approved correction only (new sessions, session_id IS NULL)
        SELECT
            la.employee_id,
            c.day_id,
            c.duration_ms,
            c.type
        FROM public.timeclock_corrections c
        JOIN latest_approved la ON la.task_id = c.correction_task_id
        WHERE c.session_id IS NULL
          AND c.duration_ms > 0
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
