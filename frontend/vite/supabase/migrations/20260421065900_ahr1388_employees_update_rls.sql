-- ============================================
-- AHR-1388: employees UPDATE RLS policy
-- ============================================
-- Original employees schema shipped with SELECT/INSERT/DELETE but no UPDATE
-- policy. Admin-authored edits from the detail modal were rejected silently
-- (0 rows affected → PGRST116). Adds the standard admin-or-owner update path
-- matching sibling tables (employee_views, employee_columns, etc.).

CREATE POLICY "Admin or owner can update employees"
    ON public.employees
    FOR UPDATE
    USING (is_admin_or_owner(organization_id));
