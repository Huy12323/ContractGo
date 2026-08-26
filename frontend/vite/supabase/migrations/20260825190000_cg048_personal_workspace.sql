-- ============================================
-- CG-048: THE PERSONAL WORKSPACE
-- ============================================
-- Everything this product does is gated on an organization. A user who signs up
-- and neither creates nor joins one has literally nothing to do: `App_VerticalNav`
-- returns null without an `$organizationId`, and `Page_Home` shows an empty
-- "My Organizations" list. The signing product itself — upload, place fields,
-- send, authenticate, sign, burn, hash-chain — is complete and org-agnostic in
-- every respect except the scope column it authorizes on.
--
-- CG-048 gives every user a personal workspace: one `organizations` row they own,
-- flagged `is_personal`, that no picker ever shows and no URL ever names.
--
-- WHY A HIDDEN ORGANIZATION AND NOT A NULLABLE SCOPE.
--
-- The alternative was to make `organization_id` NULLABLE across the eight signing
-- tables, add `owner_user_id` beside it, and rewrite every policy as
-- `(organization_id IS NOT NULL AND is_org_member(...)) OR (owner_user_id = auth.uid())`.
-- That is roughly thirty policies, the org-derivation triggers, `resolveSender`,
-- and a new `users/{id}/documents/` R2 namespace which — per the CG-036 key
-- contract — would have to be taught to the Worker, to `_shared/storage.ts`, and
-- to `useM_Files_Upload`'s key parser in step with each other. It rewrites the
-- most security-sensitive code in this schema (the CG-010 grant surface, the
-- CG-005 token vault, the hash-chained audit log) to express something the user
-- never sees.
--
-- The hidden organization changes NOTHING below the scope column. `is_org_member`
-- already returns true for `organizations.owner_id`, so all thirty policies pass
-- unmodified. `has_org_permission` short-circuits on `is_admin_or_owner`, so a
-- personal user is fully capable without a `members` row. The R2 keys stay
-- `orgs/{id}/...` and the Worker is not touched. `resolveSender` is not touched.
-- No edge function is touched.
--
-- THIS IS THE PATTERN THE SCHEMA ALREADY USES. CG-030 did exactly this to
-- `entity`: it stopped being a product concept and became plumbing derived from
-- its parent, with "no query, no state, no gate, no search param" left on the
-- client. The personal organization gets the same treatment one level up. The
-- rule it inherits is the same one CG-030 stated for entities — the flag added
-- here is a LABEL, NEVER AN AUTHORIZATION BOUNDARY. `is_personal` must not appear
-- in an RLS predicate. It decides what a picker lists, nothing more; the
-- authorization for a personal document is `owner_id`, exactly as for any other
-- organization the user owns.
--
-- WHY PROVISIONING IS LAZY AND NOT A SIGNUP TRIGGER. A trigger on `profiles`
-- would fire during `seed.sql`, which inserts its organizations and entities by
-- hand with stable ids and cannot be made idempotent against rows it did not
-- write — the same objection CG-026 recorded when it rejected an AFTER INSERT
-- trigger on `organizations` and put the seeding inside the RPC instead. An RPC
-- called on first visit also backfills every existing account through the exact
-- code path new accounts take, so there is one implementation to get right
-- rather than a trigger plus a one-off backfill that drift apart.
-- ============================================

-- --------------------------------------------
-- PHASE 1: The flag
-- --------------------------------------------
-- DEFAULT false, so every organization that exists today keeps its current
-- meaning and every existing INSERT — `create_organization`, `seed.sql` — stays
-- correct without being touched.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.is_personal IS
    'CG-048. Marks the auto-provisioned personal workspace a user gets for their '
    'own contracts. A label for pickers, NEVER an authorization boundary: it must '
    'not appear in an RLS predicate. Authorization for a personal workspace is '
    'owner_id, exactly as for any other organization the user owns.';

-- One personal workspace per user, enforced by the index rather than by trust.
-- Partial, so it constrains only the personal rows and leaves a user free to own
-- any number of real organizations. This is also what makes the idempotent
-- INSERT in PHASE 2 safe against two concurrent first-visits.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_personal_owner
    ON public.organizations (owner_id)
    WHERE is_personal;

-- --------------------------------------------
-- PHASE 2: Provisioning
-- --------------------------------------------
-- Modelled on `create_organization` as it stands after CG-024 (owner is a column,
-- not an `admins` row) and CG-026 (the org MUST get an entity or it can never
-- hold a template).
--
-- THE ENTITY IS NOT OPTIONAL. `contract_templates.entity_id` is NOT NULL, and
-- post-CG-030 it is derived from `organization_id` by `set_template_org_and_entity()`,
-- which raises if it cannot resolve one. CG-026's header describes precisely what
-- an entity-less organization looks like from the outside: not an error, silence —
-- a permanently dead Create button with no message. A personal workspace without
-- an entity would be the same dead end.
CREATE OR REPLACE FUNCTION public.ensure_personal_organization()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  personal_org_id text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- The common case by an enormous margin: every visit after the first.
  SELECT o.id INTO personal_org_id
  FROM public.organizations o
  WHERE o.owner_id = caller_id AND o.is_personal;

  IF personal_org_id IS NOT NULL THEN
    RETURN personal_org_id;
  END IF;

  -- `owner_id` IS the membership. No `admins` row and no `members` row — CG-024
  -- removed exactly that duplication from `create_organization`, and re-adding it
  -- here would put every personal user back into the two-tier state whose visible
  -- symptom was the owner appearing twice on the People page.
  --
  -- ON CONFLICT DO NOTHING against the partial unique index from PHASE 1: two
  -- concurrent first-visits both reach here, one wins, the loser writes nothing
  -- and falls through to the re-select below rather than raising at the user.
  INSERT INTO public.organizations (name, owner_id, is_personal)
  VALUES ('Personal', caller_id, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO personal_org_id;

  IF personal_org_id IS NULL THEN
    -- Lost the race. The winner's row is committed and visible; take it.
    SELECT o.id INTO personal_org_id
    FROM public.organizations o
    WHERE o.owner_id = caller_id AND o.is_personal;

    RETURN personal_org_id;
  END IF;

  -- The default entity. Named for the organization the way all three prior
  -- backfills and CG-026 named theirs. `timezone` takes its column default and
  -- `locale` stays NULL; neither is asked for, here or anywhere.
  INSERT INTO public.entities (organization_id, name)
  VALUES (personal_org_id, 'Personal');

  RETURN personal_org_id;
END;
$$;

-- CG-010. Supabase's `pg_default_acl` grants EXECUTE to `anon` and `authenticated`
-- explicitly on every new function in `public`, which makes a bare
-- `REVOKE ... FROM PUBLIC` a no-op — that is the bug CG-010 found live, where
-- `anon` could POST to `signer_token_issue` and be handed a working signing token.
-- Every REVOKE names the roles.
REVOKE EXECUTE ON FUNCTION public.ensure_personal_organization() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_personal_organization() TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_personal_organization() IS
    'CG-048. Returns the caller''s personal workspace organization id, creating it '
    'and its default entity on first call. Idempotent, and safe under concurrent '
    'first-visits via the partial unique index idx_organizations_personal_owner. '
    'Owner-only membership (CG-024): no admins row, no members row.';

-- --------------------------------------------
-- PHASE 3: Keep it out of the organization surfaces
-- --------------------------------------------
-- One edit, three effects. `get_my_member_organizations` is what `Page_Home`'s
-- list reads, what `App_OrgSwitcher` reads, AND what the `$organizationId` route
-- guard reads — so excluding the personal workspace here does not merely hide it
-- from two pickers, it makes `/{personal_org_id}/envelopes` redirect to `/`.
-- The personal workspace is reachable through `/me/*` or not at all, which means
-- there is exactly one place where personal chrome has to be right.
--
-- The filter goes on all three UNION branches even though only the first can
-- ever match today. A personal workspace has no `admins` and no `members` rows
-- by construction, but the invariant worth stating is "this function never
-- returns a personal workspace", not "the owner branch happens to be the only
-- one that could".
--
-- Signature is unchanged, so the CG-010 REVOKE/GRANT allow-list entries for
-- get_my_member_organizations() still stand and are not restated here — the same
-- convention CG-024 and CG-026 followed for create_organization.
CREATE OR REPLACE FUNCTION public.get_my_member_organizations()
RETURNS TABLE(id TEXT, name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.id, o.name FROM public.organizations o
  WHERE o.owner_id = auth.uid() AND NOT o.is_personal
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.admins a ON a.organization_id = o.id
  WHERE a.user_id = auth.uid() AND NOT o.is_personal
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.members m ON m.organization_id = o.id
  WHERE m.user_id = auth.uid() AND NOT o.is_personal
$function$;

COMMENT ON FUNCTION public.get_my_member_organizations() IS
    'Organizations the caller belongs to, by any tier. Excludes the CG-048 '
    'personal workspace: this function backs Page_Home, App_OrgSwitcher AND the '
    '$organizationId route guard, so the exclusion is also what keeps org chrome '
    'from being a back door into personal documents.';

-- --------------------------------------------
-- PHASE 4: Verify
-- --------------------------------------------
-- Structural assertions only. The behaviour of `ensure_personal_organization`
-- depends on `auth.uid()`, which is NULL in a migration, so exercising it here
-- would mean fabricating a session — the end-to-end check belongs in the app.
-- What must not silently fail is the shape: the flag, the uniqueness guarantee
-- the concurrency path leans on, the grant posture, and the PHASE 3 filter.
DO $$
DECLARE
    v_indexdef TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
          AND column_name = 'is_personal'
    ) THEN
        RAISE EXCEPTION 'CG-048 incomplete — organizations.is_personal missing';
    END IF;

    SELECT indexdef INTO v_indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_organizations_personal_owner';

    IF v_indexdef IS NULL THEN
        RAISE EXCEPTION 'CG-048 incomplete — idx_organizations_personal_owner missing';
    END IF;

    -- Both halves matter. Without UNIQUE the ON CONFLICT path in PHASE 2 is a
    -- no-op that silently permits two personal workspaces; without the WHERE it
    -- would cap every user at one organization total.
    IF v_indexdef NOT ILIKE 'CREATE UNIQUE INDEX%' OR v_indexdef NOT ILIKE '%is_personal%' THEN
        RAISE EXCEPTION 'CG-048 incomplete — idx_organizations_personal_owner is not a partial unique index: %', v_indexdef;
    END IF;

    IF has_function_privilege('anon', 'public.ensure_personal_organization()', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-048 incomplete — anon can execute ensure_personal_organization (CG-010 grant trap)';
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.ensure_personal_organization()', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-048 incomplete — authenticated cannot execute ensure_personal_organization';
    END IF;

    IF pg_get_functiondef('public.get_my_member_organizations()'::regprocedure) NOT ILIKE '%is_personal%' THEN
        RAISE EXCEPTION 'CG-048 incomplete — get_my_member_organizations does not filter the personal workspace';
    END IF;

    RAISE NOTICE 'CG-048 verified.';
END $$;
