-- ============================================
-- AHR-1193 fixup: employee_views.freeze_columns
-- ============================================
-- The preceding migration (20260420142914) was marked applied while empty, so its
-- ALTER was never executed. This fixup adds the column. Idempotent via IF NOT EXISTS.

ALTER TABLE public.employee_views
    ADD COLUMN IF NOT EXISTS freeze_columns INTEGER NOT NULL DEFAULT 0;
