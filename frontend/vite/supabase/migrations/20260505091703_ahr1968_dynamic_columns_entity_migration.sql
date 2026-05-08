-- ============================================
-- AHR-1968 — Dynamic columns: org-scoped → entity-scoped
-- ============================================
-- Migrates the entire dynamic column system from organization-scoped to
-- entity-scoped. Metadata tables (employee_columns, employee_column_choices,
-- employee_views) get entity_id. Physical per-org tables (org_<id>__employees)
-- become per-entity tables (ent_<id>__employees). Provisioning lifecycle
-- moves from organizations to entities.

-- ============================================
-- PHASE A: Metadata tables — add entity_id
-- ============================================

-- A1: employee_columns
ALTER TABLE public.employee_columns
    ADD COLUMN entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE;

UPDATE public.employee_columns
SET entity_id = (
    SELECT id FROM public.entities
    WHERE organization_id = employee_columns.organization_id
    ORDER BY created_at ASC LIMIT 1
);

ALTER TABLE public.employee_columns
    ALTER COLUMN entity_id SET NOT NULL;

CREATE INDEX idx_employee_columns_entity_id ON public.employee_columns(entity_id);

ALTER TABLE public.employee_columns
    ALTER COLUMN organization_id SET DEFAULT '';

CREATE TRIGGER trigger_set_org_id_employee_columns
    BEFORE INSERT ON public.employee_columns
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_entity();

-- A2: employee_column_choices — add entity_id, populate from parent
ALTER TABLE public.employee_column_choices
    ADD COLUMN entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE;

UPDATE public.employee_column_choices
SET entity_id = (
    SELECT entity_id FROM public.employee_columns
    WHERE id = employee_column_choices.employee_column_id
);

ALTER TABLE public.employee_column_choices
    ALTER COLUMN entity_id SET NOT NULL;

CREATE INDEX idx_employee_column_choices_entity_id ON public.employee_column_choices(entity_id);

ALTER TABLE public.employee_column_choices
    ALTER COLUMN organization_id SET DEFAULT '';

-- Update the existing trigger to also populate entity_id from parent
CREATE OR REPLACE FUNCTION public.set_org_id_from_employee_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id, entity_id
    INTO NEW.organization_id, NEW.entity_id
    FROM public.employee_columns
    WHERE id = NEW.employee_column_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_column_id %', NEW.employee_column_id;
    END IF;

    RETURN NEW;
END;
$$;

-- A3: employee_views
ALTER TABLE public.employee_views
    ADD COLUMN entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE;

UPDATE public.employee_views
SET entity_id = (
    SELECT id FROM public.entities
    WHERE organization_id = employee_views.organization_id
    ORDER BY created_at ASC LIMIT 1
);

ALTER TABLE public.employee_views
    ALTER COLUMN entity_id SET NOT NULL;

CREATE INDEX idx_employee_views_entity_id ON public.employee_views(entity_id);

ALTER TABLE public.employee_views
    ALTER COLUMN organization_id SET DEFAULT '';

CREATE TRIGGER trigger_set_org_id_employee_views
    BEFORE INSERT ON public.employee_views
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_entity();

-- ============================================
-- PHASE B: Entity-scoped dynamic table provisioning
-- ============================================

-- B1: New provisioning function for entity-scoped tables
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
END;
$$;

-- B2: Entity lifecycle triggers
CREATE OR REPLACE FUNCTION public.tg_provision_entity_employees_on_entity_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.provision_entity_employees_table(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_provision_entity_employees
    AFTER INSERT ON public.entities
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_provision_entity_employees_on_entity_insert();

CREATE OR REPLACE FUNCTION public.tg_drop_entity_employees_on_entity_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    IF OLD.id !~ '^ent_[A-Za-z0-9]+$' THEN
        RETURN OLD;
    END IF;

    v_table_name := OLD.id || '__employees';
    EXECUTE format('DROP TABLE IF EXISTS public.%I', v_table_name);
    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_drop_entity_employees
    AFTER DELETE ON public.entities
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_drop_entity_employees_on_entity_delete();

-- B3: Provision per-entity tables for all existing entities
DO $$
DECLARE
    v_ent RECORD;
BEGIN
    FOR v_ent IN SELECT id FROM public.entities LOOP
        PERFORM public.provision_entity_employees_table(v_ent.id);
    END LOOP;
END $$;

-- B4: Migrate data from org tables to entity tables
-- For each org, find its first entity (same as backfill target),
-- copy col_* columns + rows from org_<orgid>__employees to ent_<entityid>__employees
DO $$
DECLARE
    v_org         RECORD;
    v_entity_id   TEXT;
    v_org_table   TEXT;
    v_ent_table   TEXT;
    v_col         RECORD;
    v_col_list    TEXT := '';
    v_has_data    BOOLEAN;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations LOOP
        v_org_table := v_org.id || '__employees';

        -- Skip if org table doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = v_org_table AND n.nspname = 'public'
        ) THEN
            CONTINUE;
        END IF;

        -- Find the first entity for this org
        SELECT id INTO v_entity_id
        FROM public.entities
        WHERE organization_id = v_org.id
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_entity_id IS NULL THEN
            CONTINUE;
        END IF;

        v_ent_table := v_entity_id || '__employees';

        -- Copy col_* column definitions from org table to entity table
        v_col_list := '';
        FOR v_col IN
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_org_table
              AND column_name LIKE 'col_%'
            ORDER BY ordinal_position
        LOOP
            -- Add column to entity table if not exists
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = v_ent_table
                  AND column_name = v_col.column_name
            ) THEN
                EXECUTE format(
                    'ALTER TABLE public.%I ADD COLUMN %I %s',
                    v_ent_table,
                    v_col.column_name,
                    CASE
                        WHEN v_col.data_type = 'ARRAY' THEN v_col.udt_name || '[]'
                        WHEN v_col.data_type = 'USER-DEFINED' THEN v_col.udt_name
                        ELSE v_col.data_type
                    END
                );
            END IF;

            IF v_col_list != '' THEN
                v_col_list := v_col_list || ', ';
            END IF;
            v_col_list := v_col_list || quote_ident(v_col.column_name);
        END LOOP;

        -- Copy rows from org table to entity table
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_org_table) INTO v_has_data;

        IF v_has_data AND v_col_list != '' THEN
            EXECUTE format(
                'INSERT INTO public.%I (employee_id, %s) SELECT employee_id, %s FROM public.%I ON CONFLICT (employee_id) DO NOTHING',
                v_ent_table, v_col_list, v_col_list, v_org_table
            );
        ELSIF v_has_data THEN
            EXECUTE format(
                'INSERT INTO public.%I (employee_id) SELECT employee_id FROM public.%I ON CONFLICT (employee_id) DO NOTHING',
                v_ent_table, v_org_table
            );
        END IF;
    END LOOP;
END $$;

-- B5: Drop all org_<id>__employees tables
DO $$
DECLARE
    v_org RECORD;
    v_table_name TEXT;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations LOOP
        v_table_name := v_org.id || '__employees';
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', v_table_name);
    END LOOP;
END $$;

-- B6: Drop old org lifecycle triggers and functions
DROP TRIGGER IF EXISTS trigger_provision_org_employees ON public.organizations;
DROP TRIGGER IF EXISTS trigger_drop_org_employees ON public.organizations;
DROP FUNCTION IF EXISTS public.provision_org_employees_table(TEXT);
DROP FUNCTION IF EXISTS public.tg_provision_org_employees_on_org_insert();
DROP FUNCTION IF EXISTS public.tg_drop_org_employees_on_org_delete();

-- B7: Update add_employee_column RPC — entity-scoped
DROP FUNCTION IF EXISTS public.add_employee_column(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.add_employee_column(
    p_entity_id TEXT,
    p_col_name TEXT,
    p_col_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_types TEXT[] := ARRAY['text', 'numeric', 'date', 'boolean', 'text[]'];
    v_table_name  TEXT;
    v_org_id      TEXT;
BEGIN
    IF p_entity_id !~ '^ent_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid entity id: %', p_entity_id;
    END IF;

    IF p_col_name !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column name: %', p_col_name;
    END IF;

    IF NOT (p_col_type = ANY(allowed_types)) THEN
        RAISE EXCEPTION 'Invalid column type: %', p_col_type;
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.entities WHERE id = p_entity_id;

    IF NOT public.is_admin_or_owner(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden — admin or owner role required';
    END IF;

    v_table_name := p_entity_id || '__employees';

    SET LOCAL lock_timeout = '3s';
    EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN %I %s',
        v_table_name,
        p_col_name,
        p_col_type
    );
END;
$$;

-- B8: Update drop_employee_physical_column trigger — use entity_id
CREATE OR REPLACE FUNCTION public.drop_employee_physical_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    IF OLD.entity_id !~ '^ent_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid entity id: %', OLD.entity_id;
    END IF;

    IF OLD.id !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column id: %', OLD.id;
    END IF;

    v_table_name := OLD.entity_id || '__employees';

    EXECUTE format(
        'ALTER TABLE public.%I DROP COLUMN IF EXISTS %I',
        v_table_name,
        OLD.id
    );

    RETURN OLD;
END;
$$;
