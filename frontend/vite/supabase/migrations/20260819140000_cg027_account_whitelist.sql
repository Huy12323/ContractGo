-- ============================================
-- CG-027: ACCOUNT WHITELIST
-- ============================================
-- Sign-up is open and stays open. What changes is what a fresh account can
-- reach: nothing, until its address is on this list.
--
-- The list is keyed on EMAIL, not on user_id, for two reasons. First, approval
-- has to be possible before the account exists — the operator adds an address,
-- the person signs up later, and the gate is already green when they land.
-- Keying on user_id would invert that into "sign up, then tell us your id".
-- Second, it mirrors public.invitations, which already matches un-joined people
-- by address and reads the JWT's email claim to do it.
--
-- Deliberate deviation from the schema bible: there is NO organization_id here.
-- The whitelist is platform-level — it decides whether an account may use the
-- product at all, a question asked before any organization is in scope. Same
-- category as profiles, auth_tokens and cron_dispatch_config. Do not "fix" it.
--
-- The external signing surface is NOT affected. Counterparties who sign a
-- document hold an account and are deliberately not whitelisted; the gate lives
-- in the _protected route layout, which /sign/$accessToken sits outside of.
--
-- Management is by hand, in SQL or Studio:
--   INSERT INTO public.whitelist (email, note) VALUES ('someone@example.com', 'why');
--   DELETE FROM public.whitelist WHERE email = 'someone@example.com';

-- --------------------------------------------
-- PHASE 1: TABLE
-- --------------------------------------------
CREATE TABLE public.whitelist (
    id         TEXT PRIMARY KEY DEFAULT generate_id('whl'),
    -- Stored lowercase, enforced rather than hoped for. is_whitelisted() below
    -- lowercases the JWT claim and compares plainly, so a mixed-case row would
    -- silently never match — a whitelist that fails closed on a typo is a
    -- support ticket nobody can diagnose. The CHECK turns it into an insert error.
    email      TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    -- Free-text: who approved this address and why. Never read by the app.
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE already indexes `email`; this is the whole access pattern, so no
-- further indexes are warranted.

CREATE TRIGGER on_whitelist_updated
    BEFORE UPDATE ON public.whitelist
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------
-- PHASE 2: RLS — ENABLED, ZERO POLICIES
-- --------------------------------------------
-- No policies, on purpose, exactly like public.auth_tokens. A row here names a
-- person who has been granted access; the list as a whole is an operational
-- roster that no browser client has any business enumerating. RLS on with no
-- policies means every client SELECT returns zero rows regardless of who asks.
-- The one question a client may ask — "am I on it?" — is answered by the
-- SECURITY DEFINER function below, which returns a bare boolean and nothing else.
ALTER TABLE public.whitelist ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------
-- PHASE 3: THE ONLY READ PATH
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.is_whitelisted()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.whitelist w
        WHERE w.email = lower((SELECT auth.jwt()) ->> 'email')
    );
$$;

-- The email comes from the JWT claim rather than a profiles lookup so the check
-- costs no extra join and cannot be spoofed by a profile update. `auth.jwt()` is
-- wrapped in a scalar subquery per the initplan lint (0003_auth_rls_initplan).
-- An anonymous caller has no email claim, so the comparison is NULL and EXISTS
-- is false — but anon has no EXECUTE grant either, per the block below.

-- --------------------------------------------
-- GRANTS
-- --------------------------------------------
-- The CG-010 allow-list discipline: every SECURITY DEFINER surface states who
-- can reach it, in the file that creates it.
REVOKE EXECUTE ON FUNCTION public.is_whitelisted() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_whitelisted() TO authenticated, service_role;

-- --------------------------------------------
-- PHASE 4: NO REALTIME
-- --------------------------------------------
-- public.whitelist is deliberately NOT added to the supabase_realtime
-- publication. Realtime delivery is filtered by RLS, and this table has no
-- policies, so no subscriber could ever receive a row. A newly approved user
-- picks up their access on the next navigation or via the "Check again" button
-- on the pending-access screen.

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'whitelist'
    ) THEN
        RAISE EXCEPTION 'CG-027 incomplete — table public.whitelist missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'whitelist' AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'CG-027 incomplete — RLS not enabled on public.whitelist';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'whitelist'
    ) THEN
        RAISE EXCEPTION 'CG-027 incomplete — public.whitelist must have no RLS policies';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_whitelisted'
    ) THEN
        RAISE EXCEPTION 'CG-027 incomplete — function public.is_whitelisted() missing';
    END IF;

    IF has_function_privilege('anon', 'public.is_whitelisted()', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-027 incomplete — anon still holds EXECUTE on is_whitelisted()';
    END IF;
END $$;
