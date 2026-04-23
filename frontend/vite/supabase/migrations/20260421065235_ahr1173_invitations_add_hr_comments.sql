-- ============================================
-- AHR-1173: Add hr_comments JSONB on onboarding_invitations
-- ============================================
-- Append-only comment thread from HR during content review. Shape enforced in
-- TypeScript override (database.override.types.ts):
--   { id: string; author_id: string; body: string; created_at: string }[]
--
-- No RLS changes — existing invitation policies cover read (admin_or_owner +
-- invitee email match) and write (admin_or_owner).
--
-- No realtime changes — existing trg_notify_realtime_onboarding_invitations
-- emits on any UPDATE, including comment append.
-- ============================================

ALTER TABLE public.onboarding_invitations
    ADD COLUMN hr_comments JSONB NOT NULL DEFAULT '[]'::jsonb;
