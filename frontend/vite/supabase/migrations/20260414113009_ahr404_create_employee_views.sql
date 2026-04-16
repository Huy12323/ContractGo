-- ============================================
-- EMPLOYEE VIEWS (saved views for the employees table)
-- ============================================

-- PHASE 1: CREATE TABLE (top-level — direct organization_id)
CREATE TABLE public.employee_views (
    id TEXT PRIMARY KEY DEFAULT generate_id('evw'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_employee_views_organization_id ON public.employee_views(organization_id);

-- PHASE 2: RLS
-- SELECT: all org members can read the curated view library
-- INSERT/UPDATE/DELETE: only admins/owners manage views
ALTER TABLE public.employee_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_employee_views"
    ON public.employee_views FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "admin_or_owner_can_insert_employee_views"
    ON public.employee_views FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_employee_views"
    ON public.employee_views FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_employee_views"
    ON public.employee_views FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));
