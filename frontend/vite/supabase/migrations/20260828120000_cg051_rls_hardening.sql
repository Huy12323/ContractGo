-- ============================================
-- CG-051: RLS HARDENING
-- ============================================
-- The RLS posture is structurally sound: every table in `public` has RLS
-- enabled, ZERO policies name `anon` (plan decision #2 — a leaked anon key
-- reaches no rows), and every sensitive surface is RLS-on/zero-policies behind
-- SECURITY DEFINER RPCs. This file does not weaken any of that and adds no
-- `TO anon` policy. It closes nine holes in three layers:
--
--   LAYER 1 — the privilege layer BENEATH RLS. CG-025 ran `GRANT ALL ON ALL
--     TABLES IN SCHEMA public TO anon, authenticated`. Its justification ("every
--     table has RLS enabled and no policy names anon, so anon still reads
--     nothing") is true for DML and FALSE for TRUNCATE, TRIGGER and REFERENCES,
--     which RLS cannot gate — no policy can. CG-042 spotted this and fixed
--     exactly one table (`whitelist`); the identical hole is open on the other
--     31, and CG-025's `ALTER DEFAULT PRIVILEGES` means every new table inherits
--     it. PHASE 1.
--
--   LAYER 2 — two over-permissive SELECT policies leaking cross-tenant:
--     `profiles` is `USING (true)` (every email in the system readable by any
--     logged-in user) and `files` user-scope is `USING (organization_id IS NULL)`
--     (every user-scope file's metadata, INCLUDING other people's saved
--     signature PNGs). PHASE 3.
--
--   LAYER 3 — UPDATE policies with `USING` but no `WITH CHECK`. Without
--     WITH CHECK the NEW row is never re-checked, so
--     `UPDATE ... SET organization_id = '<other org>'` moves a row out of its
--     tenant. PHASE 2.
--
-- WHY THIS IS SAFE TO DO AGGRESSIVELY. The frontend uses one anon-key client and
-- NEVER `UPDATE`s `signature_requests`, `signature_request_signers`, `members`,
-- `entities` or `folders` — those are SELECT-only from the browser, with all
-- writes going through service_role edge functions that bypass RLS entirely. So
-- PHASE 2 costs nothing behaviourally. PHASE 3 is the only part with
-- user-visible surface and both narrowings are shaped below to preserve current
-- rendering (co-member avatars in particular).
--
-- STYLE NOTE: policies are dropped by INTROSPECTION rather than by name. Several
-- of the targets carry names that no longer describe them — `members`' UPDATE
-- policy is still called "Admin or owner can update employees" (CG-003 renamed
-- the table; ALTER TABLE RENAME preserves policy names) and `profiles`' policies
-- were created out-of-band and appear in no migration at all. Dropping by
-- (table, command, permissive) is the only form that is correct in both the
-- replayed-from-zero and the live-database case.
-- ============================================


-- ============================================================================
-- PHASE 1: CLOSE THE PRIVILEGE LAYER RLS CANNOT REACH
-- ============================================================================
-- Order matters, and mirrors CG-042 PHASE 1: a policy cannot subtract a
-- privilege, because RLS is checked only AFTER the privilege check has passed.

-- 1a. The schema DEFAULT first, or the next CREATE TABLE reintroduces the hole.
--     Supersedes CG-025's `GRANT ALL ON TABLES`. `authenticated` keeps plain DML
--     — that is the layer RLS is designed to sit behind — and loses the three
--     privileges RLS has no opinion about.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- 1b. Then the 31 tables that already exist. `REVOKE ALL` is deliberately NOT
--     used for `authenticated`: CG-035 revoked blanket UPDATE on `profiles` and
--     re-granted it COLUMN BY COLUMN so `profiles.whitelist` stays unwritable.
--     Naming the three privileges explicitly leaves those column grants intact;
--     a REVOKE-ALL/GRANT-ALL round trip would silently re-open `whitelist`.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public
    FROM anon, authenticated;

-- 1c. Drop `anon`'s table access entirely. This is a SEPARATELY VERIFIABLE step:
--     if anything ever needs backing out, it is 1c and 1c alone — 1a/1b are
--     unconditionally correct.
--
--     It is dead weight today. There are zero `TO anon` policies, so RLS already
--     denies anon every row; the grant only means the denial happens one layer
--     later. Every anonymous flow is served WITHOUT a table grant:
--       * /sign/$accessToken, /embed/sign/*, /verify  → service_role edge functions
--       * invitation preview                          → get_invitation_by_token(),
--         the one SECURITY DEFINER RPC deliberately granted to anon (CG-021)
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 1d. Restate CG-013's and CG-042's deliberate lockdowns verbatim. A blanket
--     re-grant is exactly how CG-025 undid them once already; restating costs
--     nothing and makes the intent survive the next sweep.
REVOKE ALL ON TABLE public.cron_dispatch_config FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.cron_dispatch_config TO service_role;
REVOKE ALL ON TABLE public.whitelist FROM PUBLIC, anon, authenticated, service_role;


-- ============================================================================
-- PHASE 2: POLICY CORRECTNESS (no app impact)
-- ============================================================================

-- --------------------------------------------
-- 2a. `members` UPDATE: TO public -> TO authenticated
-- --------------------------------------------
-- AHR-1388 created this policy with no `TO` clause, which means `TO public` —
-- the only non-restrictive `TO public` policy in the schema, and the reason
-- CG-010's allow-list had to keep `is_admin_or_owner` executable by `anon`.
-- Not exploitable today (`is_admin_or_owner` returns false when auth.uid() is
-- NULL) but it must not be the one policy that survives PHASE 1c.
DO $do$
DECLARE
    v_name TEXT;
BEGIN
    FOR v_name IN
        SELECT policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'members'
           AND cmd = 'UPDATE' AND permissive = 'PERMISSIVE'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.members', v_name);
        RAISE NOTICE 'CG-051: dropped members UPDATE policy %', v_name;
    END LOOP;
END
$do$;

CREATE POLICY "admin_or_owner_can_update_members"
    ON public.members FOR UPDATE TO authenticated
    USING      (public.is_admin_or_owner(organization_id))
    WITH CHECK (public.is_admin_or_owner(organization_id));

-- --------------------------------------------
-- 2b. `signature_requests` UPDATE: add the status guard
-- --------------------------------------------
-- Its own DELETE policy is gated on `status = 'draft'` and the analogous policy
-- on `signature_request_signers` is gated on `status = 'pending'`, but UPDATE
-- has no state qualifier at all — so a send-permissioned member can mutate a
-- COMPLETED envelope from the browser and the audit trail then describes a
-- document that no longer exists in that form.
--
-- Verified free: no frontend hook updates this table. `envelopes_send`,
-- `envelopes_void` and the cron dispatchers all run service_role and bypass RLS.
DO $do$
DECLARE
    v_name TEXT;
BEGIN
    FOR v_name IN
        SELECT policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'signature_requests'
           AND cmd = 'UPDATE' AND permissive = 'PERMISSIVE'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.signature_requests', v_name);
        RAISE NOTICE 'CG-051: dropped signature_requests UPDATE policy %', v_name;
    END LOOP;
END
$do$;

CREATE POLICY "senders_can_update_draft_signature_requests"
    ON public.signature_requests FOR UPDATE TO authenticated
    USING      (public.has_org_permission(organization_id, 'send_documents') AND status = 'draft')
    WITH CHECK (public.has_org_permission(organization_id, 'send_documents') AND status = 'draft');

-- --------------------------------------------
-- 2c. Mirror USING into WITH CHECK on every remaining UPDATE policy
-- --------------------------------------------
-- Generic rather than a list of seven, for two reasons: the names are unreliable
-- (see the style note in the header), and a list only fixes the tables that were
-- audited. The transformation is the conservative one in every case — a policy
-- that says "you may update rows matching P" and then does not say what the
-- result may look like is asking for the row to still match P afterwards.
-- Nothing in the schema documents an intentional cross-predicate move.
--
-- Restrictive policies are skipped: CG-042's four already carry WITH CHECK where
-- it applies, and a restrictive policy's absent WITH CHECK is not a widening.
DO $do$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.polname,
               c.relname,
               pg_get_expr(p.polqual, p.polrelid) AS qual,
               COALESCE(
                   (SELECT string_agg(quote_ident(pg_get_userbyid(t.oid)), ', ')
                      FROM unnest(p.polroles) AS t(oid)
                     WHERE t.oid <> 0),
                   'PUBLIC'
               ) AS roles
          FROM pg_policy p
          JOIN pg_class c     ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND p.polcmd = 'w'          -- UPDATE
           AND p.polpermissive
           AND p.polwithcheck IS NULL
           AND p.polqual IS NOT NULL
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.polname, r.relname);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
            r.polname, r.relname, r.roles, r.qual, r.qual
        );
        RAISE NOTICE 'CG-051: mirrored WITH CHECK onto %.%', r.relname, r.polname;
    END LOOP;
END
$do$;


-- ============================================================================
-- PHASE 3: NARROW THE TWO LEAKING SELECT POLICIES
-- ============================================================================

-- --------------------------------------------
-- 3a. profiles: USING (true) -> self or co-org member
-- --------------------------------------------
-- Today any logged-in user reads every profile row in the system — email,
-- full_name, avatar — with no tenant boundary at all. That is a cross-tenant
-- roster dump available to anyone who signs up.
--
-- SECURITY DEFINER because the policy on `profiles` must not re-enter `profiles`
-- to answer itself. No recursion risk: this reads only organizations/admins/
-- members, and `is_org_member` reads the same three.
CREATE OR REPLACE FUNCTION public.shares_org_with(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT EXISTS (
        SELECT 1
          FROM (
                SELECT o.id AS organization_id
                  FROM public.organizations o
                 WHERE o.owner_id = target_user_id
                 UNION
                SELECT a.organization_id FROM public.admins  a WHERE a.user_id = target_user_id
                 UNION
                SELECT m.organization_id FROM public.members m WHERE m.user_id = target_user_id
               ) theirs
         WHERE public.is_org_member(theirs.organization_id)
    );
$fn$;

COMMENT ON FUNCTION public.shares_org_with(uuid) IS
    'CG-051: true when the caller and target_user_id are in at least one organization together, at any tier.';

-- CG-010 installed an allow-list tripwire over the SECURITY DEFINER surface.
-- This helper and `is_avatar_file` below are additions to it: both are invoked
-- from inside an RLS policy, so `authenticated` MUST hold EXECUTE, and both are
-- named explicitly rather than left to Supabase's default grant so that the
-- reason is on record rather than inferred from the default.
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.shares_org_with(uuid) TO authenticated, service_role;

DO $do$
DECLARE
    v_name TEXT;
BEGIN
    FOR v_name IN
        SELECT policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'profiles'
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.profiles', v_name);
        RAISE NOTICE 'CG-051: dropped profiles SELECT policy %', v_name;
    END LOOP;
END
$do$;

-- Verified against every reader. `useQ_Me`, `useQ_Me_Whitelisted`,
-- `_protected/route.tsx`, `_auth/verify-email.tsx` and `_auth/pending-access.tsx`
-- are self-scoped. The PostgREST embeds in `useQ_Tables_Admins`,
-- `useQ_Tables_Members` and `useQ_Tables_OrganizationOwner` only ever resolve
-- people who share the org, so they keep working. `useQ_Tables_Profiles` — the
-- one hook that fetches all profiles unfiltered — has zero callers.
--
-- ONE ACCEPTED DEGRADATION: `useQ_Tables_TemplateVersions` embeds profiles via
-- `created_by`, so a version authored by someone who has since LEFT the org
-- renders a blank author name rather than erroring.
CREATE POLICY "self_or_co_member_can_view_profiles"
    ON public.profiles FOR SELECT TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR public.shares_org_with(id)
    );

-- --------------------------------------------
-- 3b. files user-scope SELECT: owner or avatar
-- --------------------------------------------
-- `USING (organization_id IS NULL)` lets any logged-in user read the r2_key,
-- name and uploaded_by of every user-scope file — including other people's saved
-- signature PNGs (CG-029). The five sibling user-scope policies all check
-- `uploaded_by`; only SELECT omits it, which reads as an oversight.
--
-- But it cannot simply become `uploaded_by = auth.uid()`: `AVATAR_FILE_SELECT`
-- (`files:avatar_file_id (r2_key)`) embeds ANOTHER user's user-scope `files` row
-- to render co-member avatars on the People page. Splitting the two cases keeps
-- that working and closes the rest — and exposes nothing new, because the R2
-- Worker already serves `users/*` avatars with no token at all (`isAvatarPath`).
CREATE OR REPLACE FUNCTION public.is_avatar_file(p_file_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.avatar_file_id = p_file_id
    );
$fn$;

COMMENT ON FUNCTION public.is_avatar_file(text) IS
    'CG-051: true when the file is some profile avatar. SECURITY DEFINER so a files policy never re-enters the narrowed profiles policy.';

REVOKE EXECUTE ON FUNCTION public.is_avatar_file(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_avatar_file(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "authenticated_can_view_user_scope_files" ON public.files;

CREATE POLICY "owner_or_avatar_can_view_user_scope_files"
    ON public.files FOR SELECT TO authenticated
    USING (
        organization_id IS NULL
        AND (
            uploaded_by = (SELECT auth.uid())
            OR public.is_avatar_file(id)
        )
    );

-- --------------------------------------------
-- 3c. files INSERT: the claimed scope must match the key
-- --------------------------------------------
-- `useM_Files_Upload` derives `organization_id` CLIENT-SIDE by string-splitting
-- `r2_key`, and nothing server-side checks the two agree — so a crafted insert
-- can file a row under organization A while pointing at `orgs/B/...`, and every
-- org-scoped listing then hands out B's key to A. The app already always writes
-- matching values, so this is assertion-only.
DROP POLICY IF EXISTS "admin_or_owner_can_insert_org_scope_files" ON public.files;
CREATE POLICY "admin_or_owner_can_insert_org_scope_files"
    ON public.files FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IS NOT NULL
        AND public.is_admin_or_owner(organization_id)
        AND starts_with(r2_key, 'orgs/' || organization_id || '/')
    );

DROP POLICY IF EXISTS "uploader_can_insert_user_scope_files" ON public.files;
CREATE POLICY "uploader_can_insert_user_scope_files"
    ON public.files FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IS NULL
        AND uploaded_by = (SELECT auth.uid())
        AND starts_with(r2_key, 'users/' || (SELECT auth.uid())::text || '/')
    );


-- ============================================================================
-- PHASE 4: HELPER-FUNCTION HYGIENE
-- ============================================================================
-- The policy helpers are the hottest code in the schema — they run inside the
-- RLS predicate of nearly every table.
--
--   * VOLATILE (the default these four inherited) makes the planner re-invoke
--     them PER ROW. STABLE lets it hoist the call for a constant argument, which
--     is the shape every one of these policies has. Measurable on `files` and
--     `signature_*` list queries.
--   * `search_path = public` is shadowable by any object in `public`; `''` is
--     not. All of these already fully qualify every reference, so ALTER FUNCTION
--     is used rather than a rewritten body — no chance of drift.
--
-- `has_org_permission` is already STABLE (CG-027) and only needs the search_path.
ALTER FUNCTION public.is_org_member(text)          STABLE;
ALTER FUNCTION public.is_admin_or_owner(text)      STABLE;
ALTER FUNCTION public.get_organization_role(text)  STABLE;
ALTER FUNCTION public.has_pending_invitation(text) STABLE;

ALTER FUNCTION public.is_org_member(text)           SET search_path = '';
ALTER FUNCTION public.is_admin_or_owner(text)       SET search_path = '';
ALTER FUNCTION public.get_organization_role(text)   SET search_path = '';
ALTER FUNCTION public.has_pending_invitation(text)  SET search_path = '';
ALTER FUNCTION public.has_org_permission(text, text) SET search_path = '';
ALTER FUNCTION public.set_template_org_and_entity()  SET search_path = '';

-- Close the EXECUTE ACL on the SECURITY DEFINER helpers that still carry the
-- default PUBLIC grant — the ones CG-010's allow-list deliberately skipped.
--
-- `authenticated` MUST KEEP EXECUTE. RLS policy expressions are evaluated with
-- the querying user's privileges, so revoking it breaks the policies themselves.
-- What changes is `anon`: CG-010 kept it only because ONE surviving policy on
-- `members` was granted to `public`, and PHASE 2a just retired that policy.
REVOKE EXECUTE ON FUNCTION public.is_org_member(text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_owner(text)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_organization_role(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_template_org_and_entity() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_org_member(text)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner(text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_role(text) TO authenticated, service_role;
-- set_template_org_and_entity is a TRIGGER function: the executor invokes it as
-- part of the INSERT, never a caller by name, so it needs no API-role grant.
GRANT EXECUTE ON FUNCTION public.set_template_org_and_entity() TO service_role;


-- ============================================================================
-- PHASE 5: CODIFY THE STORAGE BUCKETS
-- ============================================================================
-- `storage.objects` has zero policies — correct, since files live in R2 and only
-- service_role touches the Supabase bucket. Two pieces of drift:
--
--   * `files` and `files-public` were created out-of-band and appear in NO
--     migration, so `supabase db reset` produces a database without them.
--   * `org-files` still exists. 20260424140000 removed its policies but left the
--     bucket, noting the deletion had to happen out-of-band. It never did.
--
-- `files-public` is `public = true` and MUST STAY THAT WAY — `Utils_Files_PublicUrl`
-- depends on it to serve avatars under STORAGE_DRIVER=local.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
     VALUES ('files',        'files',        false, 524288000),
            ('files-public', 'files-public', true,  524288000)
ON CONFLICT (id) DO NOTHING;

-- `org-files` is NOT deleted here, and cannot be: Supabase guards its storage
-- tables with `Direct deletion from storage tables is not allowed. Use the
-- Storage API instead.` (SQLSTATE 42501). That is the same wall 20260424140000
-- hit when it said the deletion "had to happen out-of-band" — so this migration
-- states the leftover rather than pretending to remove it. It is inert: CG-009
-- dropped its last policy, so no API role can reach it.
--
--   Remove with:  supabase storage rm -r ss:///org-files   (or the Studio UI)
DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'org-files') THEN
        RAISE NOTICE
            'CG-051: bucket "org-files" still exists and is policy-less dead weight. '
            'Remove it through the Storage API; SQL cannot.';
    END IF;
END
$do$;


-- ============================================================================
-- PHASE 6: MAKE IT STICK
-- ============================================================================
-- A repeatable assertion rather than a one-shot DO block, so it also catches
-- tables added AFTER this migration. Called at the end of this file and from the
-- `database` job in CI.
CREATE OR REPLACE FUNCTION public.assert_rls_invariants()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
    v_bad TEXT;
BEGIN
    -- 1. Every table in `public` has RLS enabled.
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 1 — table(s) without RLS enabled: %', v_bad;
    END IF;

    -- 2. Neither API role holds a privilege RLS cannot gate. This is the CG-025
    --    regression, generalized from the single table CG-042 fixed.
    SELECT string_agg(DISTINCT c.relname || ' (' || r.rolname || '/' || p.priv || ')', ', ')
      INTO v_bad
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated']) AS rolname) r
     CROSS JOIN (SELECT unnest(ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES']) AS priv) p
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND has_table_privilege(r.rolname, c.oid, p.priv);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 2 — TRUNCATE/TRIGGER/REFERENCES held on: %', v_bad;
    END IF;

    -- 3. No permissive policy names `anon` (plan decision #2 — the reason a
    --    leaked anon key is worthless). Restrictive deny-all policies to PUBLIC
    --    are fine: they only ever subtract.
    SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO v_bad
      FROM pg_policy pol
      JOIN pg_class c     ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND pol.polpermissive
       AND EXISTS (
             SELECT 1 FROM unnest(pol.polroles) AS t(oid)
              WHERE t.oid <> 0 AND pg_get_userbyid(t.oid) = 'anon'
           );
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 3 — permissive policy granted to anon: %', v_bad;
    END IF;

    -- 4. No permissive UPDATE policy without WITH CHECK — the cross-tenant move.
    SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO v_bad
      FROM pg_policy pol
      JOIN pg_class c     ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND pol.polcmd = 'w' AND pol.polpermissive AND pol.polwithcheck IS NULL;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 4 — UPDATE policy with no WITH CHECK: %', v_bad;
    END IF;

    -- 5. The two database-access-only tables stay that way (CG-013, CG-042).
    --    Resolved to an oid first: has_table_privilege() on a NULL oid returns
    --    NULL, whereas the text form would ERROR if the table were ever dropped,
    --    and WHERE-clause conjuncts have no guaranteed evaluation order.
    SELECT string_agg(t.relname, ', ') INTO v_bad
      FROM (SELECT unnest(ARRAY['cron_dispatch_config', 'whitelist']) AS relname) t
     CROSS JOIN LATERAL (SELECT to_regclass('public.' || t.relname) AS oid) g
     WHERE COALESCE(has_table_privilege('authenticated', g.oid, 'SELECT'), false)
        OR COALESCE(has_table_privilege('anon',          g.oid, 'SELECT'), false);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 5 — API-role readable: %', v_bad;
    END IF;

    -- 6. The RPC-only tables have not gained a permissive policy. Each is
    --    reachable exclusively through a SECURITY DEFINER function; a permissive
    --    policy here is always someone widening a surface by accident.
    SELECT string_agg(c.relname || '.' || pol.polname, ', ') INTO v_bad
      FROM pg_policy pol
      JOIN pg_class c     ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND pol.polpermissive
       AND c.relname = ANY (ARRAY[
             'api_keys', 'webhook_endpoints',
             'signer_access_tokens', 'signer_otp_challenges',
             'whitelist', 'cron_dispatch_config'
           ]);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'RLS invariant 6 — permissive policy on an RPC-only table: %', v_bad;
    END IF;

    RAISE NOTICE 'CG-051: all six RLS invariants hold.';
END;
$fn$;

COMMENT ON FUNCTION public.assert_rls_invariants() IS
    'CG-051: raises if the RLS posture has drifted. Called at the end of the CG-051 migration and from the `database` CI job.';

REVOKE EXECUTE ON FUNCTION public.assert_rls_invariants() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assert_rls_invariants() TO service_role;


-- ============================================================================
-- VERIFY
-- ============================================================================
DO $do$
BEGIN
    PERFORM public.assert_rls_invariants();

    -- Beyond the generic invariants: the specific things this file changed.
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'profiles'
           AND cmd = 'SELECT' AND qual = 'true'
    ) THEN
        RAISE EXCEPTION 'CG-051 incomplete — profiles SELECT is still USING (true)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'files'
           AND policyname = 'owner_or_avatar_can_view_user_scope_files'
    ) THEN
        RAISE EXCEPTION 'CG-051 incomplete — files user-scope SELECT was not narrowed';
    END IF;

    IF has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
        RAISE EXCEPTION 'CG-051 incomplete — anon still holds SELECT on public.profiles';
    END IF;

    IF (SELECT p.provolatile
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'is_org_member') <> 's' THEN
        RAISE EXCEPTION 'CG-051 incomplete — is_org_member is not STABLE';
    END IF;

    RAISE NOTICE 'CG-051: RLS hardening applied.';
END
$do$;
