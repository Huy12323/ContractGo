-- ============================================
-- AHR-1291: drop employee_views.freeze_columns
-- ============================================
-- Reverts AHR-1193 (shipped same day 2026-04-20). User-configurable freeze
-- is replaced by a single hardcoded sticky __full_name column in the grid,
-- so this config column no longer has any consumer. No data preservation
-- needed — values were ephemeral.

ALTER TABLE public.employee_views
    DROP COLUMN freeze_columns;
