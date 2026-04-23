-- ============================================
-- AHR-1193: employee_views.freeze_columns
-- ============================================
-- Add per-saved-view count of leftmost frozen (sticky) columns during horizontal scroll.
-- 0 = no freeze. Matches Glide Data Grid's `freezeColumns` prop 1:1.

ALTER TABLE public.employee_views
    ADD COLUMN freeze_columns INTEGER NOT NULL DEFAULT 0;
