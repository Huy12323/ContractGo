-- Make get_timesheet_grid SECURITY DEFINER to bypass per-row RLS.
-- The function checks authorization once at the top, then runs the
-- aggregation without RLS overhead (~50ms vs ~22s for 1000+ employees).

CREATE OR REPLACE FUNCTION public.get_timesheet_grid(
    p_entity_id TEXT,
    p_start_utc TIMESTAMPTZ,
    p_end_utc TIMESTAMPTZ,
    p_timezone TEXT
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

    RETURN QUERY
    SELECT
        s.employee_id,
        (s.start_at AT TIME ZONE p_timezone)::date,
        GREATEST(
            COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'work'), 0)
            - COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'break'), 0),
            0
        )::bigint,
        COALESCE(SUM(s.duration_ms) FILTER (WHERE s.type = 'break'), 0)::bigint
    FROM public.timeclock_sessions s
    WHERE s.entity_id = p_entity_id
      AND s.start_at >= p_start_utc
      AND s.start_at < p_end_utc
      AND s.end_at IS NOT NULL
    GROUP BY s.employee_id, (s.start_at AT TIME ZONE p_timezone)::date;
END;
$$;
