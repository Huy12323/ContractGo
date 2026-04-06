-- ============================================
-- Currencies — per-organization currency identity
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.currencies (
    id TEXT PRIMARY KEY DEFAULT generate_id('cur'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT currencies_unique_code_per_org UNIQUE (organization_id, code)
);

CREATE INDEX idx_currencies_organization_id ON public.currencies(organization_id);

-- PHASE 2: ENABLE RLS
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

-- All org members can view currencies (needed for dropdowns, onboarding)
CREATE POLICY "org_members_can_view_currencies"
    ON public.currencies FOR SELECT
    TO authenticated
    USING (public.is_org_member(organization_id));

-- Only owner/admins can create currencies
CREATE POLICY "admin_or_owner_can_insert_currencies"
    ON public.currencies FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

-- Only owner/admins can update currencies
CREATE POLICY "admin_or_owner_can_update_currencies"
    ON public.currencies FOR UPDATE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- Only owner/admins can delete currencies
CREATE POLICY "admin_or_owner_can_delete_currencies"
    ON public.currencies FOR DELETE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));
