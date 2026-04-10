-- ============================================
-- EMPLOYEE COLUMNS — dynamic column metadata per org
-- ============================================

-- PHASE 1: ENUM
CREATE TYPE employee_column_type AS ENUM ('text', 'number', 'date', 'boolean', 'multi_select');

-- PHASE 2: TABLE
CREATE TABLE public.employee_columns (
    id TEXT PRIMARY KEY DEFAULT generate_id('col'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    type employee_column_type NOT NULL,
    options JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_employee_columns_organization_id ON public.employee_columns(organization_id);

-- PHASE 3: RLS
ALTER TABLE public.employee_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_employee_columns"
    ON public.employee_columns FOR SELECT TO authenticated
    USING (
        is_org_member(organization_id)
    );

CREATE POLICY "admin_or_owner_can_insert_employee_columns"
    ON public.employee_columns FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_or_owner(organization_id)
    );

CREATE POLICY "admin_or_owner_can_update_employee_columns"
    ON public.employee_columns FOR UPDATE TO authenticated
    USING (
        is_admin_or_owner(organization_id)
    );
