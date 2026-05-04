-- ============================================
-- AHR-1949 — Backfill existing data into per-org tables
-- ============================================
-- For every existing organization:
--   1. Provision its per-org table (idempotent — AHR-1947's function early-returns)
--   2. Insert one row per employee (employee_id only) into the per-org table
--   3. For each employee_columns row of that org:
--      a. ALTER TABLE <perorg> ADD COLUMN IF NOT EXISTS col_<id> <pg_type>
--      b. UPDATE <perorg> dyn SET col_<id> = emp.col_<id> FROM employees emp
--         WHERE dyn.employee_id = emp.id AND emp.organization_id = <org>
--
-- col_* on public.employees stays put — both copies coexist on disk until
-- AHR-1952 drops the global ones. This lets the frontend cutover roll back
-- without data loss.
--
-- Idempotent: rerunning is safe (ON CONFLICT DO NOTHING + IF NOT EXISTS + UPDATE).
-- ============================================

DO $$
DECLARE
    v_org      RECORD;
    v_col      RECORD;
    v_perorg   TEXT;
    v_pg_type  TEXT;
    v_emp_count INT;
    v_col_count INT;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations LOOP
        v_perorg := v_org.id || '__employees';

        -- Phase 1: ensure the per-org table exists (idempotent)
        PERFORM public.provision_org_employees_table(v_org.id);

        -- Phase 2: insert one row per employee (employee_id only)
        EXECUTE format(
            'INSERT INTO public.%I (employee_id) SELECT id FROM public.employees WHERE organization_id = %L ON CONFLICT (employee_id) DO NOTHING',
            v_perorg,
            v_org.id
        );
        GET DIAGNOSTICS v_emp_count = ROW_COUNT;

        -- Phase 3: for each col_* belonging to this org, ALTER ADD on per-org and UPDATE values
        v_col_count := 0;
        FOR v_col IN
            SELECT id, type::text AS type
            FROM public.employee_columns
            WHERE organization_id = v_org.id
        LOOP
            -- Map employee_column_type → PG type
            v_pg_type := CASE v_col.type
                WHEN 'text'          THEN 'text'
                WHEN 'number'        THEN 'numeric'
                WHEN 'date'          THEN 'date'
                WHEN 'boolean'       THEN 'boolean'
                WHEN 'single_select' THEN 'text'
                WHEN 'multi_select'  THEN 'text[]'
                WHEN 'file'          THEN 'text'
                ELSE NULL
            END;

            IF v_pg_type IS NULL THEN
                RAISE EXCEPTION 'Unknown employee_column_type: % (col_id=%)', v_col.type, v_col.id;
            END IF;

            -- ADD COLUMN on per-org (idempotent)
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I %s',
                v_perorg,
                v_col.id,
                v_pg_type
            );

            -- Copy values from global employees → per-org
            EXECUTE format(
                'UPDATE public.%I dyn SET %I = emp.%I FROM public.employees emp WHERE dyn.employee_id = emp.id AND emp.organization_id = %L',
                v_perorg,
                v_col.id,
                v_col.id,
                v_org.id
            );

            v_col_count := v_col_count + 1;
        END LOOP;

        RAISE NOTICE 'Org %: backfilled % employees, % columns', v_org.id, v_emp_count, v_col_count;
    END LOOP;
END $$;
