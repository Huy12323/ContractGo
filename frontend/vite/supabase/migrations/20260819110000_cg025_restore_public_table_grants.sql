-- ============================================
-- CG-025: RESTORE TABLE GRANTS IN SCHEMA public
-- ============================================
-- Every table in `public` was missing SELECT, INSERT, UPDATE and DELETE for
-- `anon`, `authenticated` and `service_role`. They held only `Dxtm`
-- (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) — the exact set you are left with
-- after an `ALTER DEFAULT PRIVILEGES ... REVOKE SELECT, INSERT, UPDATE, DELETE
-- ON TABLES`. The stripped default lives on the `public` schema only; `storage`
-- still carries the standard `arwdDxtm`, so every table created in `public`
-- since then inherited the hole.
--
-- RLS is not what was failing. Policies are evaluated AFTER the table-level
-- privilege check, so a correct policy on a table with no GRANT still yields
-- `42501 permission denied for table ...`. Nothing in the migration history
-- performs this revoke, so it is drift rather than intent — but asserting the
-- baseline here is what stops a fresh environment inheriting it silently.
--
-- What this broke, and why it looked like two unrelated bugs:
--
--   * The People page could not list members or admins. Every direct
--     PostgREST read 403'd, while Page_Home kept working because
--     `get_my_member_organizations()` is SECURITY DEFINER and runs as its owner,
--     which never lost its grants.
--
--   * "Send invitation" returned 404 "Organization not found".
--     `organizations_send-invitation` looks the organization up with a
--     service_role client — and service_role was missing SELECT too, so the
--     lookup failed and the function reported the row as absent.
--
-- Routines are deliberately NOT touched. CG-010 established an explicit
-- REVOKE/GRANT allow-list for every SECURITY DEFINER surface, stated in the
-- migration that creates it; a blanket routine grant here would quietly undo it.
-- ============================================

-- --------------------------------------------
-- PHASE 1: Fix the default for tables created later
-- --------------------------------------------
-- Without this the next `CREATE TABLE` in `public` reintroduces the bug.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- --------------------------------------------
-- PHASE 2: Fix the tables that already exist
-- --------------------------------------------
-- This is the Supabase baseline, not a widening. Granting `anon` is safe here
-- and was verified before writing it: every table in `public` has RLS enabled,
-- and not one policy names `anon` — so anon still reads nothing. The grant only
-- restores the layer RLS is supposed to sit behind.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- --------------------------------------------
-- PHASE 3: Re-assert the one deliberate lockdown
-- --------------------------------------------
-- `GRANT ALL ON ALL TABLES` above is indiscriminate, and CG-013 had gone out of
-- its way to close this table off: it holds the scheduler credential, has RLS on
-- and NO policies, and an admin who can read it can impersonate the scheduler.
-- Restated verbatim from 20260817093000 so the blanket grant cannot reopen it.
REVOKE ALL ON TABLE public.cron_dispatch_config FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.cron_dispatch_config TO service_role;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_missing int;
    v_leaked  int;
BEGIN
    SELECT count(*) INTO v_missing
      FROM pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relkind IN ('r', 'p')
       AND relname <> 'cron_dispatch_config'
       AND NOT has_table_privilege('authenticated', oid, 'SELECT');

    IF v_missing > 0 THEN
        RAISE EXCEPTION 'CG-025: % table(s) in public still lack SELECT for authenticated', v_missing;
    END IF;

    SELECT count(*) INTO v_leaked
      FROM pg_class
     WHERE relname = 'cron_dispatch_config'
       AND relnamespace = 'public'::regnamespace
       AND has_table_privilege('authenticated', oid, 'SELECT');

    IF v_leaked > 0 THEN
        RAISE EXCEPTION 'CG-025: cron_dispatch_config is readable by authenticated';
    END IF;

    RAISE NOTICE 'CG-025: table grants restored in schema public.';
END $$;
