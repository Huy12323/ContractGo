-- ============================================
-- RPC: add_employee_column — used by edge function
-- Adds a dynamic column to the employees table
-- ============================================

CREATE OR REPLACE FUNCTION public.add_employee_column(col_name TEXT, col_type TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_types TEXT[] := ARRAY['text', 'numeric', 'date', 'boolean', 'text[]'];
BEGIN
    -- Validate column name starts with col_ prefix (from generate_id)
    IF col_name !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column name: %', col_name;
    END IF;

    -- Validate PG type
    IF NOT (col_type = ANY(allowed_types)) THEN
        RAISE EXCEPTION 'Invalid column type: %', col_type;
    END IF;

    -- Add column with quoted identifier to preserve case
    EXECUTE format('ALTER TABLE public.employees ADD COLUMN %I %s', col_name, col_type);
END;
$$;
