-- ============================================
-- Fix rel__department__employee: remove organization_id
-- Junction tables derive org access via FK (departments.organization_id)
-- ============================================

-- Drop trigger + function (no longer needed)
DROP TRIGGER IF EXISTS trigger_set_org_id_rel__department__employee ON public.rel__department__employee;
DROP FUNCTION IF EXISTS public.set_org_id_from_department();

-- Drop old RLS policies (they reference organization_id)
DROP POLICY IF EXISTS "admin_or_owner_can_view_rel__department__employee" ON public.rel__department__employee;
DROP POLICY IF EXISTS "admin_or_owner_can_insert_rel__department__employee" ON public.rel__department__employee;
DROP POLICY IF EXISTS "admin_or_owner_can_update_rel__department__employee" ON public.rel__department__employee;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_rel__department__employee" ON public.rel__department__employee;

-- Drop organization_id column + index
DROP INDEX IF EXISTS idx_rel__department__employee_organization_id;
ALTER TABLE public.rel__department__employee DROP COLUMN organization_id;

-- Recreate RLS policies via department FK
CREATE POLICY "admin_or_owner_can_view_rel__department__employee"
    ON public.rel__department__employee FOR SELECT TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_insert_rel__department__employee"
    ON public.rel__department__employee FOR INSERT TO authenticated
    WITH CHECK (
        department_id IN (
            SELECT id FROM public.departments
            WHERE is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_update_rel__department__employee"
    ON public.rel__department__employee FOR UPDATE TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_delete_rel__department__employee"
    ON public.rel__department__employee FOR DELETE TO authenticated
    USING (
        department_id IN (
            SELECT id FROM public.departments
            WHERE is_admin_or_owner(organization_id)
        )
    );
