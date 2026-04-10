-- ============================================
-- AHR-496: EMPLOYEE ACCEPTS + FILLS CONTRACT
-- ============================================
-- 1. contracts.employee_id → nullable (employee row created on HR approval in AHR-497)
-- 2. contracts SELECT policy → add signed_by OR branch for pre-approval self-view
-- 3. onboarding_invitations SELECT → employee-facing policy (email match via JWT)
-- 4. rel__department__invitation SELECT → employee-facing policy (via invitation email match)
-- ============================================

-- PHASE 1: Make contracts.employee_id nullable
ALTER TABLE public.contracts ALTER COLUMN employee_id DROP NOT NULL;

-- PHASE 2: Update contracts SELECT policy to allow self-view via signed_by
DROP POLICY "admin_or_self_can_view_contracts" ON public.contracts;

CREATE POLICY "admin_or_self_can_view_contracts"
    ON public.contracts FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
        OR signed_by = (SELECT auth.uid())
    );

-- PHASE 3: Employee-facing SELECT policy on onboarding_invitations (email match, status='sent')
CREATE POLICY "invitee_can_view_own_onboarding_invitations"
    ON public.onboarding_invitations FOR SELECT TO authenticated
    USING (
        status = 'sent'
        AND lower(employee_email) = lower(auth.jwt() ->> 'email')
    );

-- PHASE 4: Employee-facing SELECT policy on rel__department__invitation
-- Invitee can read department junction rows for invitations matching their email
CREATE POLICY "invitee_can_view_rel__department__invitation"
    ON public.rel__department__invitation FOR SELECT TO authenticated
    USING (
        invitation_id IN (
            SELECT id FROM public.onboarding_invitations
            WHERE status = 'sent'
              AND lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );
