-- ============================================
-- AHR-1177: Let invitees receive realtime events for their own invitations
-- ============================================
-- The invitee (pre-employees-row) is not an org member, so the original AHR-846
-- policy gating on is_org_member(organization_id) hides all events from them.
-- That broke realtime for the onboarding filler: HR requests changes, but the
-- employee's `My Pending Invitations` list does NOT refresh — they have to
-- reload the page.
--
-- Fix: allow the invitee to see events scoped to their own invitation record.
-- Email match via JWT, same pattern the invitee RLS policies already use.
-- ============================================

DROP POLICY "org_member_can_view_realtime_table_events" ON public.realtime_table_events;

CREATE POLICY "org_member_or_invitee_can_view_realtime_table_events"
    ON public.realtime_table_events FOR SELECT
    TO authenticated
    USING (
        public.is_org_member(organization_id)
        OR (
            table_name = 'onboarding_invitations'
            AND record_id IN (
                SELECT id FROM public.onboarding_invitations
                WHERE lower(employee_email) = lower(auth.jwt() ->> 'email')
            )
        )
    );
