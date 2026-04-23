-- Fail fast on lock contention: ALTER TABLE waits for AccessExclusiveLock,
-- which can hang silently when another session holds a share lock on employees.
-- With lock_timeout, the RPC returns a clear error within 3s instead of
-- being killed by the edge function wall-clock deadline.
CREATE OR REPLACE FUNCTION public.add_employee_column(col_name TEXT, col_type TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_types TEXT[] := ARRAY['text', 'numeric', 'date', 'boolean', 'text[]'];
BEGIN
    IF col_name !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column name: %', col_name;
    END IF;

    IF NOT (col_type = ANY(allowed_types)) THEN
        RAISE EXCEPTION 'Invalid column type: %', col_type;
    END IF;

    SET LOCAL lock_timeout = '3s';
    EXECUTE format('ALTER TABLE public.employees ADD COLUMN %I %s', col_name, col_type);
END;
$$;
