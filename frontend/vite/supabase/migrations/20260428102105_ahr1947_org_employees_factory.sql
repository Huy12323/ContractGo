-- ============================================
-- AHR-1947 — Per-org employees factory
-- ============================================
-- Each organization gets a dedicated `<orgid>__employees` table that will hold
-- their dynamic field data (col_* columns added later by AHR-1948's RPC and
-- backfilled by AHR-1949). This T2 ships:
--
--   1. provision_org_employees_table(p_organization_id) — SECURITY DEFINER
--      function that creates the per-org table with PK FK, RLS, four policies,
--      and the audit trigger from AHR-1946 attached. Idempotent.
--
--   2. AFTER INSERT trigger on organizations — auto-provisions for new orgs.
--
--   3. AFTER DELETE trigger on organizations — drops the per-org table when
--      an org is deleted.
--
--   4. One-shot backfill (DO block) — calls the provisioning function for
--      every existing organization so there's no orphan state where future
--      RPCs reference a non-existent table.
--
-- Naming: `<organization_id>__employees`. Final form: org_aBc123XYZ__employees.
--   - The org id already begins with `org_`, so no extra prefix is added.
--   - Double-underscore separator follows the rel__department__employee precedent.
--
-- RLS shape mirrors public.employees:
--   - SELECT: is_org_member(<orgid_literal>)  — all org members read
--   - INSERT/UPDATE/DELETE: is_admin_or_owner(<orgid_literal>) — HR-only writes
--   - Org id is baked into the policy as a literal at provisioning time
--     (constant-time check; org id is implicit from the table name so storing
--     it on every row would be redundant).
--
-- Audit: trigger_audit_org_employees calls public.audit_employees_perorg(<orgid>),
-- defined in AHR-1946. The org id is passed via TG_ARGV[0] since per-org rows
-- don't carry an organization_id column.

-- ============================================
-- PHASE A: Provisioning function
-- ============================================
CREATE OR REPLACE FUNCTION public.provision_org_employees_table(p_organization_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    -- Validate org id pattern (SQL-injection barrier at table-name layer)
    IF p_organization_id !~ '^org_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid organization id: %', p_organization_id;
    END IF;

    v_table_name := p_organization_id || '__employees';

    -- Idempotency: early-return if the table already exists
    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = v_table_name
          AND n.nspname = 'public'
    ) THEN
        RETURN;
    END IF;

    -- Create the per-org table with PK FK to employees
    EXECUTE format(
        'CREATE TABLE public.%I (
            employee_id TEXT PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE
        )',
        v_table_name
    );

    -- Enable RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);

    -- Attach four policies (org id baked as a literal)
    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(%L))',
        'org_members_can_view_' || v_table_name,
        v_table_name,
        p_organization_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_insert_' || v_table_name,
        v_table_name,
        p_organization_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_update_' || v_table_name,
        v_table_name,
        p_organization_id
    );

    EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin_or_owner(%L))',
        'admin_or_owner_can_delete_' || v_table_name,
        v_table_name,
        p_organization_id
    );

    -- Attach audit trigger (function from AHR-1946); org id passed via TG_ARGV[0]
    EXECUTE format(
        'CREATE TRIGGER trigger_audit_org_employees
            AFTER INSERT OR UPDATE OR DELETE ON public.%I
            FOR EACH ROW
            EXECUTE FUNCTION public.audit_employees_perorg(%L)',
        v_table_name,
        p_organization_id
    );
END;
$$;

-- ============================================
-- PHASE B: Org lifecycle triggers
-- ============================================
CREATE OR REPLACE FUNCTION public.tg_provision_org_employees_on_org_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.provision_org_employees_table(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_provision_org_employees
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_provision_org_employees_on_org_insert();

CREATE OR REPLACE FUNCTION public.tg_drop_org_employees_on_org_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    -- Defensive pattern check; orgs created via generate_id('org') always match
    IF OLD.id !~ '^org_[A-Za-z0-9]+$' THEN
        RETURN OLD;
    END IF;

    v_table_name := OLD.id || '__employees';
    EXECUTE format('DROP TABLE IF EXISTS public.%I', v_table_name);
    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_drop_org_employees
    AFTER DELETE ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_drop_org_employees_on_org_delete();

-- ============================================
-- PHASE C: Backfill existing organizations
-- ============================================
-- Idempotent: provision_org_employees_table early-returns for existing tables.
DO $$
DECLARE
    v_org RECORD;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations LOOP
        PERFORM public.provision_org_employees_table(v_org.id);
    END LOOP;
END $$;
