-- ============================================
-- AHR-497: CONTRACTS ↔ ONBOARDING_INVITATIONS LINK
-- ============================================
-- Adds a direct FK from contracts to onboarding_invitations so the
-- approve flow can resolve the invitation that produced a given contract
-- without traversing signed_by → auth.users.email → invitation.employee_email.
-- ============================================

ALTER TABLE public.contracts
    ADD COLUMN invitation_id TEXT REFERENCES public.onboarding_invitations(id) ON DELETE SET NULL;

CREATE INDEX idx_contracts_invitation_id ON public.contracts(invitation_id);
