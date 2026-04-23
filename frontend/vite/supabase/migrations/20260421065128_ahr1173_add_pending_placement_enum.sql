-- ============================================
-- AHR-1173: Add 'pending_placement' to onboarding_invitations_status_enum
-- ============================================
-- New invitation state between 'sent' and 'accepted' — HR has approved contract
-- content, entity/department placement still pending. Set by approve-content
-- edge fn (AHR-1177), consumed by place-employee edge fn (AHR-1178).
-- ============================================

ALTER TYPE public.onboarding_invitations_status_enum ADD VALUE 'pending_placement';
