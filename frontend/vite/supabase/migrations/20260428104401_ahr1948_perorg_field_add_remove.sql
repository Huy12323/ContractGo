-- ============================================
-- AHR-1948 — Per-org field add/remove
-- ============================================
-- Replaces:
--   1. add_employee_column(text, text) — old 2-arg RPC that targeted public.employees
--   2. drop_employee_physical_column() — old trigger fn that targeted public.employees
--
-- New signatures target the per-org `<orgid>__employees` table provisioned by
-- AHR-1947. The drop trigger reads OLD.organization_id to resolve the per-org
-- table name. col_* columns still on public.employees from before this cutover
-- are left intact and will be cleaned up by AHR-1952.

-- ============================================
-- PHASE 1: Replace add_employee_column
-- ============================================
DROP FUNCTION IF EXISTS public.add_employee_column(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.add_employee_column(
    p_organization_id TEXT,
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
BEGIN
    -- Validate org id pattern
    IF p_organization_id !~ '^org_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid organization id: %', p_organization_id;
    END IF;

    -- Validate column name pattern
    IF p_col_name !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column name: %', p_col_name;
    END IF;

    -- Validate column type
    IF NOT (p_col_type = ANY(allowed_types)) THEN
        RAISE EXCEPTION 'Invalid column type: %', p_col_type;
    END IF;

    -- Authorization: caller must be admin or owner of the org
    IF NOT public.is_admin_or_owner(p_organization_id) THEN
        RAISE EXCEPTION 'Forbidden — admin or owner role required';
    END IF;

    v_table_name := p_organization_id || '__employees';

    SET LOCAL lock_timeout = '3s';
    EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN %I %s',
        v_table_name,
        p_col_name,
        p_col_type
    );
END;
$$;

-- ============================================
-- PHASE 2: Replace drop trigger function
-- ============================================
-- Trigger binding (trigger_drop_employee_physical_column on employee_columns)
-- is preserved by CREATE OR REPLACE FUNCTION; the function body is updated
-- to drop from the per-org table instead of public.employees.

CREATE OR REPLACE FUNCTION public.drop_employee_physical_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    -- Validate org id pattern (defensive; orgs created via generate_id('org') always match)
    IF OLD.organization_id !~ '^org_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid organization id: %', OLD.organization_id;
    END IF;

    -- Validate column id pattern
    IF OLD.id !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column id: %', OLD.id;
    END IF;

    v_table_name := OLD.organization_id || '__employees';

    EXECUTE format(
        'ALTER TABLE public.%I DROP COLUMN IF EXISTS %I',
        v_table_name,
        OLD.id
    );

    RETURN OLD;
END;
$$;
