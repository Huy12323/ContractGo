-- ============================================
-- AHR-1962: Timeclock events table
-- ============================================

-- PHASE 1: ENUM
CREATE TYPE public.timeclock_event_type_enum AS ENUM (
    'clock_in',
    'clock_out',
    'lunch_start',
    'lunch_end'
);

-- PHASE 2: TABLE
CREATE TABLE public.timeclock_events (
    id TEXT PRIMARY KEY DEFAULT generate_id('tce'),
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    event_type public.timeclock_event_type_enum NOT NULL,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeclock_events_employee_id ON public.timeclock_events(employee_id);
CREATE INDEX idx_timeclock_events_entity_id ON public.timeclock_events(entity_id);
CREATE INDEX idx_timeclock_events_organization_id ON public.timeclock_events(organization_id);
CREATE INDEX idx_timeclock_events_employee_entity_created
    ON public.timeclock_events(employee_id, entity_id, created_at DESC);

-- PHASE 3: TRIGGER — populate organization_id from employee
CREATE OR REPLACE FUNCTION public.set_org_id_from_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.employees
    WHERE id = NEW.employee_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_id %', NEW.employee_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_timeclock_events
    BEFORE INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_employee();

-- PHASE 4: PER-ORG CONSTRAINT
-- Within a single org, an employee (user) must clock out of Entity A before
-- clocking into Entity B. Cross-org overlap is allowed.
CREATE OR REPLACE FUNCTION public.check_timeclock_per_org_constraint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_org_id TEXT;
    v_open_session BOOLEAN;
BEGIN
    IF NEW.event_type != 'clock_in' THEN
        RETURN NEW;
    END IF;

    SELECT user_id, organization_id INTO v_user_id, v_org_id
    FROM public.employees WHERE id = NEW.employee_id;

    SELECT EXISTS (
        SELECT 1
        FROM public.timeclock_events te
        JOIN public.employees e ON e.id = te.employee_id
        WHERE e.user_id = v_user_id
          AND e.organization_id = v_org_id
          AND te.entity_id != NEW.entity_id
          AND te.id = (
              SELECT te2.id
              FROM public.timeclock_events te2
              WHERE te2.employee_id = te.employee_id
                AND te2.entity_id = te.entity_id
              ORDER BY te2.created_at DESC
              LIMIT 1
          )
          AND te.event_type IN ('clock_in', 'lunch_start')
    ) INTO v_open_session;

    IF v_open_session THEN
        RAISE EXCEPTION 'Must clock out of current entity before clocking into another entity in the same organization';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_check_timeclock_per_org_constraint
    BEFORE INSERT ON public.timeclock_events
    FOR EACH ROW
    EXECUTE FUNCTION public.check_timeclock_per_org_constraint();

-- PHASE 5: RLS
ALTER TABLE public.timeclock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_timeclock_events"
    ON public.timeclock_events FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_timeclock_events"
    ON public.timeclock_events FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_timeclock_events"
    ON public.timeclock_events FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_timeclock_events"
    ON public.timeclock_events FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "employee_can_view_own_timeclock_events"
    ON public.timeclock_events FOR SELECT TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "employee_can_insert_own_timeclock_events"
    ON public.timeclock_events FOR INSERT TO authenticated
    WITH CHECK (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- PHASE 6: REALTIME
-- Add timeclock_events to the get_organization_id_for_change resolver
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
             'timeclock_events' THEN
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

CREATE TRIGGER trg_notify_realtime_timeclock_events
    AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_events
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();
