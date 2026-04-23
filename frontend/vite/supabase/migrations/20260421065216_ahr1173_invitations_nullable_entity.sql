-- ============================================
-- AHR-1173: Drop NOT NULL on onboarding_invitations.entity_id
-- ============================================
-- Flow reversal — entity is picked at placement time (AHR-1178), not at send
-- time. No backfill needed (v0.0.1, no production data).
-- ============================================

ALTER TABLE public.onboarding_invitations ALTER COLUMN entity_id DROP NOT NULL;
