-- ============================================
-- Realtime triggers for dynamic entity employee tables
-- ============================================
-- Dynamic tables (ent_<id>__employees) don't appear in the
-- get_organization_id_for_change() CASE statement. Instead of
-- hard-coding every future table name, this migration creates a
-- lightweight trigger function that receives org_id via TG_ARGV[0]
-- (same pattern the audit trigger already uses).
--
-- Also updates provision_entity_employees_table() so every newly
-- created entity automatically gets the realtime trigger, and
-- backfills existing dynamic tables.
-- ============================================

-- PHASE 1: Trigger function for dynamic tables (org_id from TG_ARGV)
CREATE OR REPLACE FUNCTION public.notify_dynamic_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id TEXT;
    record_data JSONB;
    rec_id TEXT;
BEGIN
    v_org_id := TG_ARGV[0];

    IF TG_OP = 'DELETE' THEN
        record_data := to_jsonb(OLD);
    ELSE
        record_data := to_jsonb(NEW);
    END IF;

    IF v_org_id IS NULL THEN
        RAISE WARNING 'notify_dynamic_table_change: NULL org_id for table % op %', TG_TABLE_NAME, TG_OP;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    rec_id := record_data->>'employee_id';

    INSERT INTO public.realtime_table_events (organization_id, table_name, event_type, record_id)
    VALUES (
        v_org_id,
        TG_TABLE_NAME,
        TG_OP::public.realtime_table_events_event_type_enum,
        rec_id
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- PHASE 2: Update provisioning function to attach realtime trigger
CREATE OR REPLACE FUNCTION public.provision_entity_employees_table(p_entity_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
    v_org_id     TEXT;
BEGIN
    IF p_entity_id !~ '^ent_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid entity id: %', p_entity_id;
    END IF;

    v_table_name := p_entity_id || '__employees';

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = v_table_name
          AND n.nspname = 'public'
    ) THEN
        RETURN;
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.entities WHERE id = p_entity_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Entity not found: %', p_entity_id;
    END IF;

    EXECUTE format(
        'CREATE TABLE public.%I (
            employee_id TEXT PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE
        )',
        v_table_name
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(%L))',
        'org_members_can_view_' || v_table_name,
        v_table_name,
        v_org_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_insert_' || v_table_name,
        v_table_name,
        v_org_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_update_' || v_table_name,
        v_table_name,
        v_org_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_delete_' || v_table_name,
        v_table_name,
        v_org_id
    );

    EXECUTE format(
        'CREATE TRIGGER trigger_audit_entity_employees
            AFTER INSERT OR UPDATE OR DELETE ON public.%I
            FOR EACH ROW
            EXECUTE FUNCTION public.audit_employees_perorg(%L)',
        v_table_name,
        v_org_id
    );

    EXECUTE format(
        'CREATE TRIGGER trigger_realtime_entity_employees
            AFTER INSERT OR UPDATE OR DELETE ON public.%I
            FOR EACH ROW
            EXECUTE FUNCTION public.notify_dynamic_table_change(%L)',
        v_table_name,
        v_org_id
    );
END;
$$;

-- PHASE 3: Backfill — attach realtime trigger to all existing dynamic tables
DO $$
DECLARE
    r RECORD;
    v_org_id TEXT;
BEGIN
    FOR r IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname ~ '^ent_[A-Za-z0-9]+__employees$'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trigger_realtime_entity_employees'
              AND tgrelid = (SELECT oid FROM pg_class WHERE relname = r.table_name AND relnamespace = 'public'::regnamespace)
        ) THEN
            SELECT e.organization_id INTO v_org_id
            FROM public.entities e
            WHERE e.id = replace(r.table_name, '__employees', '');

            IF v_org_id IS NOT NULL THEN
                EXECUTE format(
                    'CREATE TRIGGER trigger_realtime_entity_employees
                        AFTER INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW
                        EXECUTE FUNCTION public.notify_dynamic_table_change(%L)',
                    r.table_name,
                    v_org_id
                );
            END IF;
        END IF;
    END LOOP;
END;
$$;
