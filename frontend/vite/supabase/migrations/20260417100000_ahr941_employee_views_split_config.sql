-- ============================================
-- AHR-941 — employee_views.config split into per-key columns
-- Motivation: surgical per-field updates without clobbering unrelated keys.
-- Pre-launch: no data preservation needed; dropping config implicitly wipes old nested filters.
-- ============================================

-- PHASE 1: ADD COLUMNS (default to empty structures)
ALTER TABLE public.employee_views
    ADD COLUMN filter JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN sort JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN group_by JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN hidden_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN field_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN field_widths JSONB NOT NULL DEFAULT '{}'::jsonb;

-- PHASE 2: DROP THE OLD CONFIG COLUMN
ALTER TABLE public.employee_views DROP COLUMN config;
