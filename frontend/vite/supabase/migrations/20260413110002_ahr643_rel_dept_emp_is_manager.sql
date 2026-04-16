-- ============================================
-- AHR-643: ADD is_manager TO rel__department__employee
-- ============================================
-- A department can have zero, one, or many managers.
-- This flag enables the org chart to distinguish managers
-- from regular employees in the department card collapsible.
-- ============================================

ALTER TABLE public.rel__department__employee
    ADD COLUMN is_manager BOOLEAN NOT NULL DEFAULT false;
