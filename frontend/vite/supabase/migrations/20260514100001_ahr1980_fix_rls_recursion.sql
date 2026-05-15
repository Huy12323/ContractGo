-- ============================================
-- Fix infinite RLS recursion between correction_tasks ↔ rel__correction_task__department
-- Root cause: correction_tasks manager SELECT policy queries rel__correction_task__department,
-- whose admin/employee SELECT policies query back into correction_tasks.
-- Fix: route rel__correction_task__department policies through departments (no recursion).
-- ============================================

-- Drop recursive policies
DROP POLICY IF EXISTS "admin_or_owner_can_view_rel__correction_task__department" ON public.rel__correction_task__department;
DROP POLICY IF EXISTS "admin_or_owner_can_insert_rel__correction_task__department" ON public.rel__correction_task__department;
DROP POLICY IF EXISTS "admin_or_owner_can_update_rel__correction_task__department" ON public.rel__correction_task__department;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_rel__correction_task__department" ON public.rel__correction_task__department;
DROP POLICY IF EXISTS "employee_can_view_own_rel__correction_task__department" ON public.rel__correction_task__department;
DROP POLICY IF EXISTS "employee_can_insert_own_rel__correction_task__department" ON public.rel__correction_task__department;

-- Admin/owner: route through departments → organization_id (no correction_tasks reference)
CREATE POLICY "admin_or_owner_can_view_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_insert_rel__correction_task__department"
    ON public.rel__correction_task__department FOR INSERT TO authenticated
    WITH CHECK (
        department_id IN (
            SELECT id FROM public.departments
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_update_rel__correction_task__department"
    ON public.rel__correction_task__department FOR UPDATE TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_delete_rel__correction_task__department"
    ON public.rel__correction_task__department FOR DELETE TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

-- Employee: use SECURITY DEFINER helper to bypass RLS on correction_tasks lookup
CREATE OR REPLACE FUNCTION public.owns_correction_task(p_correction_task_id TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.correction_tasks ct
        JOIN public.employees e ON e.id = ct.employee_id
        WHERE ct.id = p_correction_task_id
          AND e.user_id = (SELECT auth.uid())
    );
END;
$$;

CREATE POLICY "employee_can_view_own_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (public.owns_correction_task(correction_task_id));

CREATE POLICY "employee_can_insert_own_rel__correction_task__department"
    ON public.rel__correction_task__department FOR INSERT TO authenticated
    WITH CHECK (public.owns_correction_task(correction_task_id));
