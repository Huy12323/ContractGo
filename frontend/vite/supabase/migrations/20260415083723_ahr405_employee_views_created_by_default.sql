-- ============================================
-- AHR-405: DEFAULT created_by ON employee_views
-- ============================================
-- Lets the Create mutation send only { organization_id, name, config };
-- the row stamps itself with the calling user.
-- ============================================

ALTER TABLE public.employee_views
    ALTER COLUMN created_by SET DEFAULT auth.uid();
