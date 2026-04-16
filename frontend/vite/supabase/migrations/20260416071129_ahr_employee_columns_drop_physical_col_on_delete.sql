-- ============================================
-- Drop physical col_* from employees on employee_columns DELETE
-- Bug: deleting an employee_columns row (via Field Manager or org CASCADE)
-- left the ALTER TABLE ADDed physical column on public.employees behind.
-- ============================================

-- PHASE 1: CLEANUP TRIGGER
CREATE OR REPLACE FUNCTION public.drop_employee_physical_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.id !~ '^col_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'Invalid column id: %', OLD.id;
    END IF;

    EXECUTE format('ALTER TABLE public.employees DROP COLUMN IF EXISTS %I', OLD.id);

    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_drop_employee_physical_column
    AFTER DELETE ON public.employee_columns
    FOR EACH ROW EXECUTE FUNCTION public.drop_employee_physical_column();

-- PHASE 2: BACKFILL — drop orphan physical columns with no matching employee_columns row
DO $$
DECLARE
    orphan_col TEXT;
BEGIN
    FOR orphan_col IN
        SELECT c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'employees'
          AND c.column_name ~ '^col_[A-Za-z0-9]+$'
          AND NOT EXISTS (
              SELECT 1 FROM public.employee_columns ec WHERE ec.id = c.column_name
          )
    LOOP
        EXECUTE format('ALTER TABLE public.employees DROP COLUMN IF EXISTS %I', orphan_col);
    END LOOP;
END;
$$;
