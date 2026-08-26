-- ============================================
-- CG-020: ORGANIZATION INVITATIONS (admin OR member)
-- ============================================
-- Three things were tangled together in `admin_invitations`:
--
--   1. The table could only ever mean "become an admin" — the tier was baked
--      into the table name and into `accept_invitation`'s hard-coded INSERT.
--   2. Only `organizations.owner_id` could send one. Every other write path in
--      the app gates on `is_admin_or_owner()`; this was the lone exception, and
--      it made "invite a colleague" an owner-only chore.
--   3. `public.members` — the tier an invitation should be able to grant — was
--      unreachable from the app entirely. Nothing outside `seed.sql` has ever
--      written a row to it.
--
-- This migration renames the table rather than creating a new one, so existing
-- pending invitations, their tokens, the `unique(organization_id, email)`
-- constraint the edge-function upsert depends on, the realtime publication
-- membership, and the CG-018 event trigger all survive untouched.
--
-- The RPCs that read the table are rewritten in CG-021 (next file), so the
-- rename and the function bodies land in separate, individually reviewable
-- transactions.
-- ============================================

-- PHASE 1: RENAME
ALTER TABLE public.admin_invitations RENAME TO invitations;

-- Indexes keep their name through a rename, and these still carry the ORIGINAL
-- `org_admin_invitations` name — the 20260406 rename renamed the table but not
-- them. Fixing both hops at once keeps `idx_{table}_{column}` honest, the same
-- discipline CG-003 applied when `employees` became `members`.
ALTER INDEX IF EXISTS idx_org_admin_invitations_org_email RENAME TO idx_invitations_org_email;
ALTER INDEX IF EXISTS idx_org_admin_invitations_token     RENAME TO idx_invitations_token;
ALTER INDEX IF EXISTS idx_org_admin_invitations_email     RENAME TO idx_invitations_email;

-- PHASE 2: ROLE
-- Plain text + CHECK, matching `status` on the same table, rather than an enum.
-- The two tiers are `admins` and `members` — the two tables `accept_invitation`
-- can write to. `owner` is deliberately absent: ownership transfers, it is not
-- invited.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'member'));

COMMENT ON COLUMN public.invitations.role IS
  'Tier granted on acceptance: ''admin'' inserts into public.admins, ''member'' into public.members. Defaults to ''admin'' so pre-CG-020 rows backfill to what they actually meant.';

-- PHASE 3: MAKE `members.entity_id` OPTIONAL
-- `entity_id` was NOT NULL because a member used to live in a per-entity
-- dynamic table (`ent_<id>__employees`). CG-003 dropped those tables and their
-- provisioning triggers, and `create_organization` has never created an entity
-- (AHR-556), so a brand-new ContractGo organization has zero entities to point
-- at. Accepting a member invitation is impossible while this column is
-- required. It stays as an optional FK for the HR-era organizations that still
-- populate it.
ALTER TABLE public.members ALTER COLUMN entity_id DROP NOT NULL;

COMMENT ON COLUMN public.members.entity_id IS
  'Optional since CG-020. HR-era grouping; ContractGo organizations have no entities, and members invited through public.accept_invitation leave this NULL.';

-- PHASE 4: RLS
-- Old policies were owner-only EXISTS subqueries against `organizations`. They
-- are replaced with the project helper (see
-- .claude/skills/ext-supabase-rls-policies/SKILL.md) and the project naming
-- convention. `is_admin_or_owner` is SECURITY DEFINER and reads auth.uid()
-- itself, so it is called directly in USING/WITH CHECK — no subquery wrapping,
-- and no recursive-RLS hazard.
DROP POLICY IF EXISTS "Owner can view invitations"       ON public.invitations;
DROP POLICY IF EXISTS "Owner can delete invitations"     ON public.invitations;
DROP POLICY IF EXISTS "Invitee can view own invitations"   ON public.invitations;
DROP POLICY IF EXISTS "Invitee can update own invitations" ON public.invitations;

CREATE POLICY admin_or_owner_can_select_invitations
  ON public.invitations FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(organization_id));

CREATE POLICY admin_or_owner_can_insert_invitations
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY admin_or_owner_can_update_invitations
  ON public.invitations FOR UPDATE TO authenticated
  USING (public.is_admin_or_owner(organization_id))
  WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY admin_or_owner_can_delete_invitations
  ON public.invitations FOR DELETE TO authenticated
  USING (public.is_admin_or_owner(organization_id));

-- The invitee is not a member of the organization yet — that is what the
-- invitation is for — so no org helper can see them. The JWT email claim is the
-- only thing that ties them to the row, and it costs no DB roundtrip.
CREATE POLICY invitee_can_select_own_invitations
  ON public.invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));

-- How `status = 'rejected'` gets set from Page_Invitation.
CREATE POLICY invitee_can_update_own_invitations
  ON public.invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email'));

-- PHASE 5: ADMIN MANAGEMENT
-- `accept_invitation` is SECURITY DEFINER and bypasses these, but the People
-- page's own reads do not. `admins` and `members` already carry
-- `is_org_member(organization_id)` SELECT policies from the CG-003 rename, so
-- listing needs nothing new. The one gap is INSERT on `admins`: it was
-- owner-only, which contradicts an admin being able to invite an admin.
DROP POLICY IF EXISTS "Owner can add admins" ON public.admins;

CREATE POLICY admin_or_owner_can_insert_admins
  ON public.admins FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(organization_id));

-- Removal stays owner-only ("Owner can remove admins" is left in place):
-- demoting a peer is a different decision from inviting one, and removal is out
-- of scope for CG-020.

-- PHASE 6: REALTIME
-- The org-scoped event bus resolves an organization id by matching
-- `TG_TABLE_NAME` against a hard-coded list. A table rename does not update
-- that list, and the ELSE branch only RAISEs a WARNING — so without this the
-- rename would silently degrade every invitation event to a NULL
-- organization_id and no client would ever be notified. Same reason CG-004 and
-- CG-009 each had to rewrite this function.
CREATE OR REPLACE FUNCTION public.get_organization_id_for_change(
    p_table_name TEXT,
    p_record_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    org_id TEXT;
BEGIN
    CASE p_table_name
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        WHEN 'entities', 'admins', 'members',
             'contract_templates', 'contract_template_versions',
             'files', 'folders', 'invitations',
             'signature_requests', 'signature_request_signers',
             'signature_captures' THEN
            org_id := p_record_data->>'organization_id';

        ELSE
            RAISE WARNING 'get_organization_id_for_change: unknown table %', p_table_name;
            RETURN NULL;
    END CASE;

    RETURN org_id;
END;
$function$;

-- The trigger itself survived the rename attached to the right table, but under
-- a name that now lies about which table it watches.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notify_realtime_admin_invitations'
      AND tgrelid = 'public.invitations'::regclass
  ) THEN
    ALTER TRIGGER trg_notify_realtime_admin_invitations
      ON public.invitations RENAME TO trg_notify_realtime_invitations;
  END IF;
END $$;

-- PHASE 7: VERIFY
-- Assert rather than trust — the same discipline as CG-009's closing block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_invitations') THEN
    RAISE EXCEPTION 'CG-020 incomplete — public.admin_invitations still present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invitations' AND column_name = 'role'
  ) THEN
    RAISE EXCEPTION 'CG-020 incomplete — public.invitations.role missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'entity_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'CG-020 incomplete — public.members.entity_id is still NOT NULL';
  END IF;
END $$;
