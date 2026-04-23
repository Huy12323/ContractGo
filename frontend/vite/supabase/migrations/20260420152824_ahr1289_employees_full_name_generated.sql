-- ============================================
-- AHR-1289: employees.__full_name
-- ============================================
-- Derived display name as a GENERATED STORED column.
-- TRIM collapses the empty-both case (first_name = '' AND last_name = '')
-- to '' instead of ' ' so the grid renders it as a null placeholder.
-- Double-underscore prefix marks "system-managed / read-only" — FE detects
-- via name.startsWith('__'). Postgres rejects direct writes at the engine
-- level; no trigger needed.

ALTER TABLE public.employees
    ADD COLUMN __full_name TEXT
        GENERATED ALWAYS AS (TRIM(first_name || ' ' || last_name)) STORED;
