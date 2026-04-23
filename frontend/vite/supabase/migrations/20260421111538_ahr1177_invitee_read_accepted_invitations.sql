-- ============================================
-- AHR-1177: Broaden invitee SELECT to all their invitations (not just 'sent')
-- ============================================
-- After employee submits, invitation.status flips 'sent' → 'accepted'. Original policy
-- gated on status='sent', which blocked the invitee from reading their own invitation
-- post-submit. That breaks the resubmit loop: HR clicks Request Changes, employee
-- revisits /onboarding/{token}, but RLS hides the invitation.
--
-- Fix: allow invitee to read any invitation that matches their email (not just 'sent').
-- Same for the department junction. Admin/owner read path unchanged.
-- ============================================

DROP POLICY "invitee_can_view_own_onboarding_invitations" ON public.onboarding_invitations;

CREATE POLICY "invitee_can_view_own_onboarding_invitations"
    ON public.onboarding_invitations FOR SELECT TO authenticated
    USING (
        lower(employee_email) = lower(auth.jwt() ->> 'email')
    );

DROP POLICY "invitee_can_view_rel__department__invitation" ON public.rel__department__invitation;

CREATE POLICY "invitee_can_view_rel__department__invitation"
    ON public.rel__department__invitation FOR SELECT TO authenticated
    USING (
        invitation_id IN (
            SELECT id FROM public.onboarding_invitations
            WHERE lower(employee_email) = lower(auth.jwt() ->> 'email')
        )
    );
