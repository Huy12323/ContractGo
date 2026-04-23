-- ============================================
-- AHR-1177: Invitee can read the contract linked to their invitation
-- ============================================
-- When HR clicks "Request Changes", request-changes edge fn clears
-- contracts.signed_by to null (signature is stale after edits). That removes
-- the invitee's access via the existing `signed_by = auth.uid()` branch, so
-- they cannot SELECT their own contract on reload — the filler loses the
-- prior submission and falls back to HR's prefill only.
--
-- Fix: add a 4th branch that lets the invitee read contracts attached to
-- invitations addressed to their email. Mirrors the invitee email-match
-- pattern already used on onboarding_invitations + rel__department__invitation.
-- ============================================

DROP POLICY "admin_or_self_can_view_contracts" ON public.contracts;

CREATE POLICY "admin_or_self_can_view_contracts"
    ON public.contracts FOR SELECT
    TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
        OR signed_by = (SELECT auth.uid())
        OR invitation_id IN (
            SELECT id FROM public.onboarding_invitations
            WHERE lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );
