-- ============================================
-- CG-019: NOTIFICATION TYPE `organization_invitation`
-- ============================================
-- CG-020 generalises `admin_invitations` into `invitations` with a `role`
-- column, so the notification a person receives is no longer always "you are an
-- admin now". One parameterised type replaces the role-specific one.
--
-- This migration contains NOTHING but the ALTER TYPE, on purpose. Postgres
-- refuses to USE an enum value in the same transaction that ADDs it, and the
-- Supabase CLI wraps each migration file in one transaction — so anything that
-- referenced 'organization_invitation' here (a backfill, a CHECK, a seed) would
-- fail with "unsafe use of new value of enum type".
--
-- The old `admin_invitation` value stays. Notification rows already reference
-- it, and Postgres cannot drop an enum value.
-- ============================================

ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'organization_invitation';
