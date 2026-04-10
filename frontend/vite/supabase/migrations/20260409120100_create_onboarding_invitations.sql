-- ============================================
-- ONBOARDING INVITATIONS + DEPARTMENT JUNCTION
-- ============================================

-- PHASE 1: ENUM
CREATE TYPE public.onboarding_invitations_status_enum AS ENUM ('sent', 'accepted', 'expired', 'revoked');

-- PHASE 2: CREATE TABLE (top-level — direct organization_id)
CREATE TABLE public.onboarding_invitations (
    id TEXT PRIMARY KEY DEFAULT generate_id('obi'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_email TEXT NOT NULL,
    entity_id TEXT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    contract_template_id TEXT NOT NULL REFERENCES public.contract_templates(id) ON DELETE CASCADE,
    prefilled_fields JSONB NOT NULL DEFAULT '{}',
    invitation_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    status public.onboarding_invitations_status_enum NOT NULL DEFAULT 'sent',
    sent_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_onboarding_invitations_organization_id ON public.onboarding_invitations(organization_id);
CREATE INDEX idx_onboarding_invitations_entity_id ON public.onboarding_invitations(entity_id);
CREATE INDEX idx_onboarding_invitations_contract_template_id ON public.onboarding_invitations(contract_template_id);
CREATE INDEX idx_onboarding_invitations_invitation_token ON public.onboarding_invitations(invitation_token);
CREATE INDEX idx_onboarding_invitations_sent_by ON public.onboarding_invitations(sent_by);

-- PHASE 3: RLS (admin/owner CRUD — employee SELECT deferred to AHR-496)
ALTER TABLE public.onboarding_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_onboarding_invitations"
    ON public.onboarding_invitations FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_onboarding_invitations"
    ON public.onboarding_invitations FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_onboarding_invitations"
    ON public.onboarding_invitations FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_onboarding_invitations"
    ON public.onboarding_invitations FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- PHASE 4: JUNCTION TABLE (no organization_id — derives via invitation FK)
CREATE TABLE public.rel__department__invitation (
    department_id TEXT NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    invitation_id TEXT NOT NULL REFERENCES public.onboarding_invitations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (department_id, invitation_id)
);

CREATE INDEX idx_rel__department__invitation_department_id ON public.rel__department__invitation(department_id);
CREATE INDEX idx_rel__department__invitation_invitation_id ON public.rel__department__invitation(invitation_id);

-- PHASE 5: JUNCTION RLS (derives org access via invitation parent)
ALTER TABLE public.rel__department__invitation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_rel__department__invitation"
    ON public.rel__department__invitation FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(
            (SELECT organization_id FROM public.onboarding_invitations WHERE id = invitation_id)
        )
    );

CREATE POLICY "admin_or_owner_can_insert_rel__department__invitation"
    ON public.rel__department__invitation FOR INSERT TO authenticated
    WITH CHECK (
        public.is_admin_or_owner(
            (SELECT organization_id FROM public.onboarding_invitations WHERE id = invitation_id)
        )
    );

CREATE POLICY "admin_or_owner_can_delete_rel__department__invitation"
    ON public.rel__department__invitation FOR DELETE TO authenticated
    USING (
        public.is_admin_or_owner(
            (SELECT organization_id FROM public.onboarding_invitations WHERE id = invitation_id)
        )
    );
