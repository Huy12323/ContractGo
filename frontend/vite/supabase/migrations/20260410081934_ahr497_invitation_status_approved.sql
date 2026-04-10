-- ============================================
-- AHR-497: ADD 'approved' TO onboarding_invitations_status_enum
-- ============================================
-- Postgres requires ALTER TYPE ADD VALUE to run outside a multi-statement
-- transaction with prior DDL — kept in its own migration file.
--
-- State machine after this migration:
--   sent → accepted → approved
--           ↘ (expired | revoked)
-- ============================================

ALTER TYPE public.onboarding_invitations_status_enum ADD VALUE 'approved';
