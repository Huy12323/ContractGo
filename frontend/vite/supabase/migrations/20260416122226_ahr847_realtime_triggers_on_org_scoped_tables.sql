-- ============================================
-- AHR-847: Org-id resolution + triggers on all org-scoped tables
-- Wires AFTER INSERT/UPDATE/DELETE triggers on 15 org-scoped tables.
-- Each fires notify_organization_of_table_change(), which uses
-- get_organization_id_for_change() to resolve the org_id
-- (direct column for 13 tables, 1-hop for the 2 relation tables)
-- and INSERTs one row into realtime_table_events.
-- Unresolvable org_id: RAISE WARNING, skip event emission — never block
-- the originating mutation.
-- ============================================

-- ============================================
-- PHASE 1: Org-id resolver
-- ============================================
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
        -- Special: the record IS the organization
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        -- Direct organization_id column (13 tables)
        WHEN 'entities', 'admins', 'employees', 'departments',
             'contract_templates', 'contracts',
             'employee_columns', 'employee_column_choices', 'employee_views',
             'onboarding_invitations', 'files', 'admin_invitations' THEN
            org_id := p_record_data->>'organization_id';

        -- 1-hop via department_id
        WHEN 'rel__department__employee' THEN
            SELECT d.organization_id INTO org_id
            FROM public.departments d
            WHERE d.id = p_record_data->>'department_id';

        -- 1-hop via invitation_id
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

-- ============================================
-- PHASE 2: Trigger function (single, generic)
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_organization_of_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    record_data JSONB;
    org_id TEXT;
    rec_id TEXT;
BEGIN
    -- DELETE uses OLD; INSERT/UPDATE use NEW
    IF TG_OP = 'DELETE' THEN
        record_data := to_jsonb(OLD);
    ELSE
        record_data := to_jsonb(NEW);
    END IF;

    org_id := public.get_organization_id_for_change(TG_TABLE_NAME, record_data);

    -- Unresolvable org_id: warn and exit. MUST NOT block the originating mutation.
    IF org_id IS NULL THEN
        RAISE WARNING 'notify_organization_of_table_change: NULL org_id for table % op %', TG_TABLE_NAME, TG_OP;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    rec_id := record_data->>'id';

    INSERT INTO public.realtime_table_events (organization_id, table_name, event_type, record_id)
    VALUES (
        org_id,
        TG_TABLE_NAME,
        TG_OP::public.realtime_table_events_event_type_enum,
        rec_id
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ============================================
-- PHASE 3: Attach triggers to 15 org-scoped tables
-- ============================================

CREATE TRIGGER trg_notify_realtime_organizations
    AFTER INSERT OR UPDATE OR DELETE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_entities
    AFTER INSERT OR UPDATE OR DELETE ON public.entities
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_admins
    AFTER INSERT OR UPDATE OR DELETE ON public.admins
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_employees
    AFTER INSERT OR UPDATE OR DELETE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_departments
    AFTER INSERT OR UPDATE OR DELETE ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_contract_templates
    AFTER INSERT OR UPDATE OR DELETE ON public.contract_templates
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_contracts
    AFTER INSERT OR UPDATE OR DELETE ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_employee_columns
    AFTER INSERT OR UPDATE OR DELETE ON public.employee_columns
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_employee_column_choices
    AFTER INSERT OR UPDATE OR DELETE ON public.employee_column_choices
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_employee_views
    AFTER INSERT OR UPDATE OR DELETE ON public.employee_views
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_onboarding_invitations
    AFTER INSERT OR UPDATE OR DELETE ON public.onboarding_invitations
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_files
    AFTER INSERT OR UPDATE OR DELETE ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_admin_invitations
    AFTER INSERT OR UPDATE OR DELETE ON public.admin_invitations
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_rel__department__employee
    AFTER INSERT OR UPDATE OR DELETE ON public.rel__department__employee
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_rel__department__invitation
    AFTER INSERT OR UPDATE OR DELETE ON public.rel__department__invitation
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();
