-- ============================================
-- AHR-496: INVITEE SELECT POLICIES ON JOINED TABLES
-- ============================================
-- The onboarding filler page loads the invitation plus several joined rows:
--   organizations, entities, contract_templates, departments (via junction),
--   employee_columns, employee_column_choices
-- The invitee is authenticated but NOT yet a member of the org (no admins/employees
-- row), so admin-only and org-member-only SELECT policies return nothing, causing
-- the filler UI to render empty. Each policy below lets an invitee read exactly
-- the rows referenced by an active onboarding invitation matching their JWT email.
-- ============================================

-- PHASE 1: organizations — invitee can view the org their invitation points at
CREATE POLICY "invitee_can_view_onboarding_invited_organizations"
    ON public.organizations FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT organization_id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );

-- PHASE 2: entities — invitee can view the entity their invitation points at
CREATE POLICY "invitee_can_view_onboarding_invited_entities"
    ON public.entities FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT entity_id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );

-- PHASE 3: contract_templates — invitee can view the template their invitation references
CREATE POLICY "invitee_can_view_onboarding_invited_contract_templates"
    ON public.contract_templates FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT contract_template_id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );

-- PHASE 4: departments — invitee can view departments referenced by their invitation's junction
CREATE POLICY "invitee_can_view_onboarding_invited_departments"
    ON public.departments FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT rdi.department_id
            FROM public.rel__department__invitation rdi
            JOIN public.onboarding_invitations oi ON oi.id = rdi.invitation_id
            WHERE oi.status = 'sent'
              AND lower(oi.employee_email) = lower(auth.jwt() ->> 'email')
        )
    );

-- PHASE 5: employee_columns — invitee can view custom columns for their invitation's org
-- (needed so App_ContractFiller can render fields with the correct types/choices)
CREATE POLICY "invitee_can_view_onboarding_invited_employee_columns"
    ON public.employee_columns FOR SELECT TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );

-- PHASE 6: employee_column_choices — invitee can view choices for their invitation's org
CREATE POLICY "invitee_can_view_onboarding_invited_employee_column_choices"
    ON public.employee_column_choices FOR SELECT TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );
