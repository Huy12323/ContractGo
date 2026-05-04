-- ============================================
-- AHR-1952 — Drop col_* from global public.employees
-- ============================================
-- DESTRUCTIVE. After AHR-1948–1951 cut all reads and writes of dynamic data
-- over to per-org `<orgid>__employees` tables, the col_* columns on global
-- public.employees are unread and unwritten. AHR-1949 has already backfilled
-- their values into per-org tables. This migration removes the now-redundant
-- col_* columns from global.
--
-- Pre-deploy checklist (production): see plan file
-- cycles/2026-18/employee-management/AHR-1944/AHR-1952-drop-col-from-global.md
--
-- No rollback. If anything breaks post-deploy, recovery is manual:
-- ALTER TABLE public.employees ADD COLUMN col_<id> <type> for each, then
-- copy values back from per-org tables.
-- ============================================

DO $$
DECLARE
    v_col   RECORD;
    v_count INT := 0;
BEGIN
    FOR v_col IN
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'employees'
          AND column_name ~ '^col_[A-Za-z0-9]+$'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.employees DROP COLUMN IF EXISTS %I',
            v_col.column_name
        );
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'AHR-1952: dropped % col_* columns from public.employees', v_count;
END $$;
