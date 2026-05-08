-- ============================================
-- Timeclock summaries — denormalized session table
-- ============================================

-- PHASE 1: STATUS ENUM
CREATE TYPE public.timeclock_summary_status_enum AS ENUM ('open', 'closed');

-- PHASE 2: TABLE
CREATE TABLE public.timeclock_summaries (
    id TEXT PRIMARY KEY DEFAULT generate_id('tcs'),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    worked_ms BIGINT NOT NULL DEFAULT 0,
    break_ms BIGINT NOT NULL DEFAULT 0,
    status public.timeclock_summary_status_enum NOT NULL DEFAULT 'open',
    edited_by UUID REFERENCES auth.users(id),
    edited_at TIMESTAMPTZ,
    notes TEXT,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeclock_summaries_employee_id ON public.timeclock_summaries(employee_id);
CREATE INDEX idx_timeclock_summaries_entity_id ON public.timeclock_summaries(entity_id);
CREATE INDEX idx_timeclock_summaries_organization_id ON public.timeclock_summaries(organization_id);
CREATE INDEX idx_timeclock_summaries_clock_in_at ON public.timeclock_summaries(clock_in_at);
CREATE INDEX idx_timeclock_summaries_entity_clock_in ON public.timeclock_summaries(entity_id, clock_in_at);

-- PHASE 3: ORG ID TRIGGER (child table pattern from employee)
CREATE TRIGGER trigger_set_org_id_timeclock_summaries
    BEFORE INSERT ON public.timeclock_summaries
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_employee();

-- PHASE 4: AUTO-COMPUTE TRIGGER
-- Fires on every timeclock_events INSERT. Maintains the summary row.
CREATE OR REPLACE FUNCTION public.timeclock_events_update_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_summary_id TEXT;
    v_worked BIGINT;
    v_break BIGINT;
    v_clock_in TIMESTAMPTZ;
    v_clock_out TIMESTAMPTZ;
BEGIN
    IF NEW.event_type = 'clock_in' THEN
        -- Create new summary row
        INSERT INTO public.timeclock_summaries (employee_id, entity_id, clock_in_at, status)
        VALUES (NEW.employee_id, NEW.entity_id, NEW.created_at, 'open');
        RETURN NEW;
    END IF;

    -- Find the open summary for this employee+entity
    SELECT id, clock_in_at INTO v_summary_id, v_clock_in
    FROM public.timeclock_summaries
    WHERE employee_id = NEW.employee_id
      AND entity_id = NEW.entity_id
      AND status = 'open'
      AND edited_by IS NULL
    ORDER BY clock_in_at DESC
    LIMIT 1;

    IF v_summary_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Recalculate from raw events for this session
    SELECT
        COALESCE(SUM(CASE
            WHEN e.event_type IN ('clock_out', 'lunch_start') THEN
                EXTRACT(EPOCH FROM (e.created_at - lag_at)) * 1000
            ELSE 0
        END), 0)::BIGINT,
        COALESCE(SUM(CASE
            WHEN e.event_type IN ('lunch_end', 'clock_out') AND lag_type = 'lunch_start' THEN
                EXTRACT(EPOCH FROM (e.created_at - lag_at)) * 1000
            ELSE 0
        END), 0)::BIGINT,
        MAX(CASE WHEN e.event_type = 'clock_out' THEN e.created_at END)
    INTO v_worked, v_break, v_clock_out
    FROM (
        SELECT
            event_type,
            created_at,
            LAG(created_at) OVER (ORDER BY created_at) AS lag_at,
            LAG(event_type) OVER (ORDER BY created_at) AS lag_type
        FROM public.timeclock_events
        WHERE employee_id = NEW.employee_id
          AND entity_id = NEW.entity_id
          AND created_at >= v_clock_in
          AND created_at <= COALESCE(v_clock_out, NEW.created_at)
        ORDER BY created_at
    ) e
    WHERE lag_at IS NOT NULL;

    -- Work = total session minus breaks
    v_worked := EXTRACT(EPOCH FROM (COALESCE(v_clock_out, NEW.created_at) - v_clock_in)) * 1000 - v_break;

    UPDATE public.timeclock_summaries
    SET worked_ms = GREATEST(v_worked, 0),
        break_ms = v_break,
        clock_out_at = v_clock_out,
        status = CASE WHEN v_clock_out IS NOT NULL THEN 'closed' ELSE 'open' END,
        updated_at = now()
    WHERE id = v_summary_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_timeclock_events_update_summary
    AFTER INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.timeclock_events_update_summary();

-- PHASE 5: RLS
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

-- No direct INSERT/DELETE for users — managed by trigger + admin PATCH only

-- PHASE 6: REALTIME
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

-- PHASE 7: BACKFILL from existing events
-- Process each employee+entity's events chronologically to build summaries
DO $$
DECLARE
    r RECORD;
    v_current_summary_id TEXT;
    v_current_clock_in TIMESTAMPTZ;
    v_current_employee TEXT;
    v_current_entity TEXT;
    v_worked BIGINT;
    v_break BIGINT;
    v_last_event_at TIMESTAMPTZ;
    v_last_event_type TEXT;
BEGIN
    v_current_summary_id := NULL;

    FOR r IN
        SELECT id, employee_id, entity_id, event_type, created_at, organization_id
        FROM public.timeclock_events
        ORDER BY employee_id, entity_id, created_at
    LOOP
        IF r.event_type = 'clock_in' THEN
            -- Close any open summary for this employee+entity
            IF v_current_summary_id IS NOT NULL
               AND v_current_employee = r.employee_id
               AND v_current_entity = r.entity_id THEN
                UPDATE public.timeclock_summaries
                SET status = 'closed',
                    clock_out_at = v_last_event_at,
                    updated_at = now()
                WHERE id = v_current_summary_id AND status = 'open';
            END IF;

            -- Start new summary
            INSERT INTO public.timeclock_summaries (employee_id, entity_id, clock_in_at, status)
            VALUES (r.employee_id, r.entity_id, r.created_at, 'open')
            RETURNING id INTO v_current_summary_id;

            v_current_clock_in := r.created_at;
            v_current_employee := r.employee_id;
            v_current_entity := r.entity_id;
            v_worked := 0;
            v_break := 0;
            v_last_event_at := r.created_at;
            v_last_event_type := r.event_type;

        ELSIF v_current_summary_id IS NOT NULL
              AND v_current_employee = r.employee_id
              AND v_current_entity = r.entity_id THEN

            IF r.event_type = 'lunch_start' AND v_last_event_type IN ('clock_in', 'lunch_end') THEN
                v_worked := v_worked + EXTRACT(EPOCH FROM (r.created_at - v_last_event_at))::BIGINT * 1000;
            ELSIF r.event_type = 'lunch_end' AND v_last_event_type = 'lunch_start' THEN
                v_break := v_break + EXTRACT(EPOCH FROM (r.created_at - v_last_event_at))::BIGINT * 1000;
            ELSIF r.event_type = 'clock_out' THEN
                IF v_last_event_type IN ('clock_in', 'lunch_end') THEN
                    v_worked := v_worked + EXTRACT(EPOCH FROM (r.created_at - v_last_event_at))::BIGINT * 1000;
                ELSIF v_last_event_type = 'lunch_start' THEN
                    v_break := v_break + EXTRACT(EPOCH FROM (r.created_at - v_last_event_at))::BIGINT * 1000;
                END IF;

                UPDATE public.timeclock_summaries
                SET worked_ms = v_worked,
                    break_ms = v_break,
                    clock_out_at = r.created_at,
                    status = 'closed',
                    updated_at = now()
                WHERE id = v_current_summary_id;

                v_current_summary_id := NULL;
            END IF;

            v_last_event_at := r.created_at;
            v_last_event_type := r.event_type;
        END IF;
    END LOOP;

    -- Close any remaining open summaries with computed values
    IF v_current_summary_id IS NOT NULL THEN
        UPDATE public.timeclock_summaries
        SET worked_ms = v_worked,
            break_ms = v_break,
            updated_at = now()
        WHERE id = v_current_summary_id;
    END IF;
END;
$$;
