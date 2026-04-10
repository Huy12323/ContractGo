-- ============================================
-- ONBOARDING FORMS — per-organization form templates
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.onboarding_forms (
    id TEXT PRIMARY KEY DEFAULT generate_id('obf'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layout JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT onboarding_forms_unique_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX idx_onboarding_forms_organization_id ON public.onboarding_forms(organization_id);

-- PHASE 2: ENABLE RLS
ALTER TABLE public.onboarding_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_onboarding_forms"
    ON public.onboarding_forms FOR SELECT
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_onboarding_forms"
    ON public.onboarding_forms FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_onboarding_forms"
    ON public.onboarding_forms FOR UPDATE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_onboarding_forms"
    ON public.onboarding_forms FOR DELETE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));
