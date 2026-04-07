-- ============================================
-- Drop entity_employees, create rel__department__employee
-- AHR-324: Replace entity-employee table with proper
-- department-employee junction table (Bible conventions)
-- ============================================

-- PHASE 1: DROP OLD TABLE
-- CASCADE drops: trigger, RLS policies, indexes, unique constraint
DROP TABLE public.entity_employees CASCADE;

-- PHASE 2: CREATE JUNCTION TABLE
CREATE TABLE public.rel__department__employee (
    department_id TEXT NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (department_id, employee_id)
);

CREATE INDEX idx_rel__department__employee_department_id ON public.rel__department__employee(department_id);
CREATE INDEX idx_rel__department__employee_employee_id ON public.rel__department__employee(employee_id);

-- PHASE 3: ENABLE RLS
ALTER TABLE public.rel__department__employee ENABLE ROW LEVEL SECURITY;

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
