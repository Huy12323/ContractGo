-- ============================================
-- AHR-1980: Employee/member RLS read policies
-- All org members can see departments and entities in their org.
-- Employees can see their own department memberships.
-- Managers can see all department approval rows for corrections they manage.
-- ============================================

-- 1. Employees can view their own entity
DROP POLICY IF EXISTS "employee_can_view_own_entity" ON public.entities;
CREATE POLICY "employee_can_view_own_entity"
    ON public.entities FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT entity_id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- 2. Employees can view their own department memberships
DROP POLICY IF EXISTS "employee_can_view_own_rel__department__employee" ON public.rel__department__employee;
CREATE POLICY "employee_can_view_own_rel__department__employee"
    ON public.rel__department__employee FOR SELECT TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- 3. All org members can view all departments in their org
DROP POLICY IF EXISTS "employee_can_view_own_departments" ON public.departments;
DROP POLICY IF EXISTS "org_member_can_view_departments" ON public.departments;
CREATE POLICY "org_member_can_view_departments"
    ON public.departments FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

-- 4. Managers can see ALL department approval rows for corrections linked to their managed departments
--    Uses SECURITY DEFINER to avoid recursive RLS on rel__correction_task__department
DROP POLICY IF EXISTS "manager_can_view_rel__correction_task__department" ON public.rel__correction_task__department;

CREATE OR REPLACE FUNCTION public.get_managed_correction_task_ids()
RETURNS SETOF TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT rctd.correction_task_id
    FROM public.rel__correction_task__department rctd
    WHERE rctd.department_id IN (
        SELECT mgr.department_id
        FROM public.rel__department__employee mgr
        JOIN public.employees e ON e.id = mgr.employee_id
        WHERE mgr.is_manager = true AND e.user_id = (SELECT auth.uid())
    );
END;
$$;

CREATE POLICY "manager_can_view_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (correction_task_id IN (SELECT public.get_managed_correction_task_ids()));
