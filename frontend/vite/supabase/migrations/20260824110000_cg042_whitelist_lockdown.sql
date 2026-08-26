-- ============================================
-- CG-042: WHITELIST — DATABASE-ACCESS-ONLY LOCKDOWN
-- ============================================
-- `public.whitelist` decides whether an account may use the product at all. The
-- intended posture, stated in CG-027 and restated in CG-034, is that NO API role
-- can read or write it: the roster is managed by hand in SQL or Studio, by
-- someone who holds a database connection. Two holes were left open.
--
--   1. TRUNCATE IS NOT SUBJECT TO RLS. CG-025 ran
--      `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated,
--      service_role` and set the same as the schema default, so `authenticated`
--      holds TRUNCATE (and REFERENCES, TRIGGER, MAINTAIN) on this table. RLS
--      does not gate TRUNCATE — no policy can. Any logged-in user could empty
--      the roster, and CG-035's statement-level resync trigger would then
--      dutifully set `profiles.whitelist = false` for every account in the
--      system. RLS-with-no-policies never covered this; only the absence of the
--      grant does.
--
--   2. service_role holds BYPASSRLS. Zero policies stop `anon` and
--      `authenticated`; they do not stop service_role, which reads and writes
--      the table freely regardless of what any policy says. Nothing in the app
--      touches this table with a service_role client — the only server-side
--      reader is `whitelist_matches()`, which is SECURITY DEFINER and runs as
--      its owner — so the privilege is pure exposure: anyone who obtains the
--      service key can grant themselves access to the product.
--
-- CG-013's `cron_dispatch_config` is the precedent for both the shape and the
-- reasoning; this table is stricter only in that service_role loses its grant
-- too, because nothing needs it.
--
-- WHAT STILL WORKS, and why nothing here breaks it: `whitelist_matches()`,
-- `is_whitelisted()`, `handle_new_user()` and `resync_profiles_whitelist()` are
-- all SECURITY DEFINER, owned by `postgres`, and execute with the owner's
-- privileges. Table grants to API roles are irrelevant to them. The gate the app
-- actually reads is `profiles.whitelist` (CG-035), which is untouched.
--
-- WHO CAN STILL MANAGE THE ROSTER: the table owner and any BYPASSRLS superuser
-- role — i.e. a direct database connection or Studio's SQL editor, which is
-- exactly the audience CG-027 named.
--   INSERT INTO public.whitelist (pattern, value, note)
--        VALUES ('domain', 'gotosoft.net', 'partner org, approved by X');

-- --------------------------------------------
-- PHASE 1: THE PRIVILEGE (the load-bearing half)
-- --------------------------------------------
-- Order matters and mirrors CG-035 PHASE 4: the table-level grant has to come
-- off, because a policy cannot subtract a privilege and RLS is checked only
-- AFTER the privilege check has already passed. This is also the only line in
-- this file that has any effect on service_role.
REVOKE ALL ON TABLE public.whitelist FROM PUBLIC, anon, authenticated, service_role;

-- The schema default set by CG-025 (`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- TABLES`) applies at CREATE TABLE time only, so it cannot silently re-grant
-- this existing table. A future blanket `GRANT ALL ON ALL TABLES IN SCHEMA
-- public` would — as CG-025 itself did — which is why PHASE 2 exists.

-- --------------------------------------------
-- PHASE 2: THE POLICIES (the half that survives a re-grant)
-- --------------------------------------------
-- RLS is already enabled with zero policies, which denies everything to any role
-- without BYPASSRLS. That default is silent: it is indistinguishable from
-- "someone forgot to write the policies", and the next person to add a
-- well-meaning permissive policy — or the next blanket grant — reopens the table
-- with no line in the file objecting.
--
-- These are RESTRICTIVE policies. Restrictive policies are ANDed with everything
-- else, so `USING (false)` cannot be widened by any permissive policy added
-- later: the result stays false no matter what is ORed on the permissive side.
-- Written per command rather than as one FOR ALL because a `FOR ALL` restrictive
-- policy with only USING leaves INSERT unconstrained (INSERT is checked by WITH
-- CHECK, and USING does not apply to it) — the one gap that would let the roster
-- be added to.
--
-- RLS is deliberately NOT forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
-- Forcing it would apply these policies to the table owner as well, locking out
-- the exact person this design intends to be the sole manager.
CREATE POLICY "whitelist_deny_select" ON public.whitelist
    AS RESTRICTIVE FOR SELECT TO public
    USING (false);

CREATE POLICY "whitelist_deny_insert" ON public.whitelist
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (false);

CREATE POLICY "whitelist_deny_update" ON public.whitelist
    AS RESTRICTIVE FOR UPDATE TO public
    USING (false)
    WITH CHECK (false);

CREATE POLICY "whitelist_deny_delete" ON public.whitelist
    AS RESTRICTIVE FOR DELETE TO public
    USING (false);

COMMENT ON TABLE public.whitelist IS
    'Platform-level access roster. Managed only through a direct database '
    'connection: all table privileges are revoked from anon, authenticated and '
    'service_role, and four RESTRICTIVE deny-all policies make the closure '
    'explicit and un-widenable by a later permissive policy (CG-042). The only '
    'client-facing answers are profiles.whitelist (CG-035) and is_whitelisted().';

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_role  TEXT;
    v_priv  TEXT;
    v_count INT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                      'TRUNCATE', 'REFERENCES', 'TRIGGER']
        LOOP
            IF has_table_privilege(v_role, 'public.whitelist', v_priv) THEN
                RAISE EXCEPTION 'CG-042 incomplete — % still holds % on public.whitelist',
                                v_role, v_priv;
            END IF;
        END LOOP;
    END LOOP;

    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'whitelist' AND permissive = 'RESTRICTIVE';

    IF v_count <> 4 THEN
        RAISE EXCEPTION 'CG-042 incomplete — expected 4 restrictive policies on public.whitelist, found %',
                        v_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'whitelist' AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'CG-042 incomplete — a permissive policy exists on public.whitelist';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'whitelist' AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'CG-042 incomplete — RLS not enabled on public.whitelist';
    END IF;

    -- The owner path the operator relies on must still work, and the definer
    -- functions that read the table must not have been collateral damage.
    INSERT INTO public.whitelist (pattern, value, note)
         VALUES ('exact', 'cg042-probe@verify.test', 'CG-042 self-check, deleted below');

    IF NOT public.whitelist_matches('cg042-probe@verify.test') THEN
        RAISE EXCEPTION 'CG-042 incomplete — whitelist_matches() no longer reads the table';
    END IF;

    DELETE FROM public.whitelist WHERE value = 'cg042-probe@verify.test';

    RAISE NOTICE 'CG-042: public.whitelist is database-access-only.';
END $$;
