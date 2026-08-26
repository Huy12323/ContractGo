-- ============================================
-- CG-023: MEMBERSHIP MANAGEMENT
-- ============================================
-- CG-020/021 made it possible to get INTO an organization. Nothing has ever been
-- able to change or undo that: once an invitation is accepted the tier is
-- permanent, the person cannot be removed, and ownership cannot move. The only
-- way to un-invite somebody was to delete the organization.
--
-- All four operations land as SECURITY DEFINER RPCs rather than client-side
-- table writes, for one reason: a role change is a move between two tables.
-- `admins` and `members` are separate relations, so promoting is DELETE+INSERT
-- and demoting is the reverse. Split across two round trips from the browser,
-- a failure between them strands the person in neither table — no access, no
-- row, nothing on the People page to fix it with. Inside a function it is one
-- transaction and the invariant "exactly one tier per user per organization"
-- cannot be observed broken.
--
-- The authorization rules here are not new policy. They are the rules the RLS
-- already encodes, restated where they can be enforced across two tables:
--
--   promote member -> admin   admin or owner   (members DELETE + admins INSERT
--                                               are both is_admin_or_owner)
--   demote admin -> member    owner only       ("Owner can remove admins", the
--                                               policy CG-020 deliberately left
--                                               alone)
--   remove a member           admin or owner
--   remove an admin           owner only
--   remove yourself           anyone but the owner
--   transfer ownership        owner only
--
-- The owner is a COLUMN on `organizations`, not a row in a tier table, which is
-- why every function below special-cases them first. There is no way to demote
-- or remove an owner: doing so would leave `organizations.owner_id` pointing at
-- somebody with no membership, or leave the row ownerless. Ownership moves by
-- transfer or not at all.
--
-- No new tables, so no realtime work: `organizations`, `admins` and `members`
-- are all already in the allow-list inside get_organization_id_for_change
-- (CG-020 Phase 6), and every write below fires their existing triggers.
-- ============================================

-- --------------------------------------------
-- set_organization_role(org_id, target_user_id, new_role)
-- --------------------------------------------
-- Moves one person between the `admins` and `members` tiers. Returns
-- {status: 'changed'|'unchanged', role}.
CREATE OR REPLACE FUNCTION public.set_organization_role(
  org_id         text,
  target_user_id uuid,
  new_role       text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id    uuid;
  caller_role  text;
  org_owner    uuid;
  current_tier text;
  target_email text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF new_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Unknown role "%" — expected admin or member', new_role;
  END IF;

  SELECT owner_id INTO org_owner FROM public.organizations WHERE id = org_id;
  IF org_owner IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  caller_role := public.get_organization_role(org_id);
  IF caller_role IS NULL OR caller_role = 'member' THEN
    RAISE EXCEPTION 'Only an admin or the owner can change roles';
  END IF;

  IF target_user_id = org_owner THEN
    RAISE EXCEPTION 'The owner''s role cannot be changed — transfer ownership instead';
  END IF;

  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.admins
                        WHERE organization_id = org_id AND user_id = target_user_id) THEN 'admin'
           WHEN EXISTS (SELECT 1 FROM public.members
                        WHERE organization_id = org_id AND user_id = target_user_id) THEN 'member'
         END
    INTO current_tier;

  IF current_tier IS NULL THEN
    RAISE EXCEPTION 'That person is not in this organization';
  END IF;

  IF current_tier = new_role THEN
    RETURN json_build_object('status', 'unchanged', 'role', new_role);
  END IF;

  -- Demotion is removal from `admins` wearing a different hat, so it inherits
  -- removal's rule. An admin promoting a member is adding a peer; an admin
  -- demoting a peer is overruling one, and that stays with the owner.
  IF current_tier = 'admin' AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can demote an admin';
  END IF;

  IF new_role = 'admin' THEN
    DELETE FROM public.members
    WHERE organization_id = org_id AND user_id = target_user_id;

    INSERT INTO public.admins (user_id, organization_id)
    VALUES (target_user_id, org_id)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.admins
    WHERE organization_id = org_id AND user_id = target_user_id;

    -- `entity_id` stays NULL and `email` is copied off the profile, exactly as
    -- accept_invitation does it (CG-021). The other columns on `members` are
    -- HR-era leftovers with defaults and are deliberately not populated.
    SELECT email INTO target_email FROM public.profiles WHERE id = target_user_id;

    -- Guarded explicitly rather than by ON CONFLICT. The only unique constraint
    -- on `members` is (entity_id, user_id) — an HR-era key — and `entity_id` is
    -- NULL for every ContractGo member. NULLs are distinct in a btree, so that
    -- constraint never fires here and ON CONFLICT DO NOTHING would be silently
    -- inert, leaving duplicate rows behind for somebody who was in both tiers.
    -- Same reason accept_invitation checks EXISTS first.
    IF NOT EXISTS (
      SELECT 1 FROM public.members
      WHERE organization_id = org_id AND user_id = target_user_id
    ) THEN
      INSERT INTO public.members (user_id, organization_id, email)
      VALUES (target_user_id, org_id, lower(coalesce(target_email, '')));
    END IF;
  END IF;

  RETURN json_build_object('status', 'changed', 'role', new_role);
END;
$$;

-- --------------------------------------------
-- remove_from_organization(org_id, target_user_id)
-- --------------------------------------------
-- One function for "remove them" and "leave" — same invariants, same owner
-- guard, and self-removal differs only in who is allowed to ask. Returns
-- {status: 'removed', role, self}.
CREATE OR REPLACE FUNCTION public.remove_from_organization(
  org_id         text,
  target_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id    uuid;
  caller_role  text;
  org_owner    uuid;
  current_tier text;
  target_email text;
  is_self      boolean;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT owner_id INTO org_owner FROM public.organizations WHERE id = org_id;
  IF org_owner IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  caller_role := public.get_organization_role(org_id);
  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'You are not in this organization';
  END IF;

  -- Covers the owner leaving as well as anyone trying to remove them: the
  -- organization would be left pointing at a non-member either way.
  IF target_user_id = org_owner THEN
    RAISE EXCEPTION 'The owner cannot be removed — transfer ownership first';
  END IF;

  is_self := target_user_id = caller_id;

  IF NOT is_self AND caller_role = 'member' THEN
    RAISE EXCEPTION 'Only an admin or the owner can remove people';
  END IF;

  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.admins
                        WHERE organization_id = org_id AND user_id = target_user_id) THEN 'admin'
           WHEN EXISTS (SELECT 1 FROM public.members
                        WHERE organization_id = org_id AND user_id = target_user_id) THEN 'member'
         END
    INTO current_tier;

  IF current_tier IS NULL THEN
    RAISE EXCEPTION 'That person is not in this organization';
  END IF;

  IF current_tier = 'admin' AND NOT is_self AND caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can remove an admin';
  END IF;

  IF current_tier = 'admin' THEN
    DELETE FROM public.admins
    WHERE organization_id = org_id AND user_id = target_user_id;
  ELSE
    DELETE FROM public.members
    WHERE organization_id = org_id AND user_id = target_user_id;
  END IF;

  -- The accepted invitation row outlives the membership, and
  -- unique(organization_id, email) means it would collide with a fresh invite
  -- to the same address. Removing someone has to remove the paper trail that
  -- says they were let in, or they can never be let in again.
  SELECT email INTO target_email FROM public.profiles WHERE id = target_user_id;
  IF target_email IS NOT NULL THEN
    DELETE FROM public.invitations
    WHERE organization_id = org_id AND lower(email) = lower(target_email);
  END IF;

  RETURN json_build_object(
    'status', 'removed',
    'role',   current_tier,
    'self',   is_self
  );
END;
$$;

-- --------------------------------------------
-- transfer_organization_ownership(org_id, new_owner_user_id)
-- --------------------------------------------
-- Returns {status: 'transferred'|'unchanged', previous_owner, new_owner}.
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(
  org_id            text,
  new_owner_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id    uuid;
  current_tier text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.get_organization_role(org_id) <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can transfer ownership';
  END IF;

  IF new_owner_user_id = caller_id THEN
    RETURN json_build_object(
      'status',         'unchanged',
      'previous_owner', caller_id,
      'new_owner',      caller_id
    );
  END IF;

  -- Deliberately not "any user id": ownership can only land on somebody who has
  -- already accepted an invitation to THIS organization. Otherwise a typo hands
  -- the organization to a stranger with no way back.
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.admins
                        WHERE organization_id = org_id AND user_id = new_owner_user_id) THEN 'admin'
           WHEN EXISTS (SELECT 1 FROM public.members
                        WHERE organization_id = org_id AND user_id = new_owner_user_id) THEN 'member'
         END
    INTO current_tier;

  IF current_tier IS NULL THEN
    RAISE EXCEPTION 'Ownership can only be transferred to someone already in this organization';
  END IF;

  UPDATE public.organizations
  SET owner_id   = new_owner_user_id,
      updated_at = now()
  WHERE id = org_id;

  -- The owner is a column, never also a tier row — see is_org_member, which ORs
  -- the three tiers rather than assuming they nest.
  DELETE FROM public.admins
  WHERE organization_id = org_id AND user_id = new_owner_user_id;

  DELETE FROM public.members
  WHERE organization_id = org_id AND user_id = new_owner_user_id;

  -- Admin, not member: someone handing over the keys still has an organization
  -- to help run, and demoting them to member would strip access that only the
  -- new owner could give back.
  INSERT INTO public.admins (user_id, organization_id)
  VALUES (caller_id, org_id)
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'status',         'transferred',
    'previous_owner', caller_id,
    'new_owner',      new_owner_user_id
  );
END;
$$;

-- --------------------------------------------
-- get_organization_person(org_id, target_user_id)
-- --------------------------------------------
-- Everything the People detail drawer shows about one person, resolved across
-- the three tiers in one round trip. Returns NULL when the target is not in the
-- organization. Readable by any member — this is the directory, not an admin
-- surface; the actions it hosts are gated by the functions above.
CREATE OR REPLACE FUNCTION public.get_organization_person(
  org_id         text,
  target_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_owner    uuid;
  person_role  text;
  joined_at    timestamptz;
  result       json;
BEGIN
  IF NOT public.is_org_member(org_id) THEN
    RAISE EXCEPTION 'You are not in this organization';
  END IF;

  SELECT owner_id INTO org_owner FROM public.organizations WHERE id = org_id;

  IF target_user_id = org_owner THEN
    person_role := 'owner';
    SELECT created_at INTO joined_at FROM public.organizations WHERE id = org_id;
  ELSE
    SELECT 'admin', a.created_at INTO person_role, joined_at
    FROM public.admins a
    WHERE a.organization_id = org_id AND a.user_id = target_user_id;

    IF person_role IS NULL THEN
      SELECT 'member', m.created_at INTO person_role, joined_at
      FROM public.members m
      WHERE m.organization_id = org_id AND m.user_id = target_user_id;
    END IF;
  END IF;

  IF person_role IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'user_id',    p.id,
    'full_name',  p.full_name,
    -- A member invited before they filled in a profile has an address on the
    -- membership row and nowhere else, the same fallback Page_People renders.
    'email',      coalesce(p.email, m.email),
    'avatar_url', p.avatar_url,
    'phone',      p.phone,
    'role',       person_role,
    'joined_at',  joined_at
  ) INTO result
  FROM public.profiles p
  LEFT JOIN public.members m
    ON m.user_id = p.id AND m.organization_id = org_id
  WHERE p.id = target_user_id;

  RETURN result;
END;
$$;

-- --------------------------------------------
-- GRANTS
-- --------------------------------------------
-- The CG-010 allow-list discipline: every SECURITY DEFINER surface states who
-- can reach it, in the file that creates it. None of these are callable before
-- sign-in — unlike get_invitation_by_token, they all answer questions about an
-- organization the caller must already belong to.
REVOKE EXECUTE ON FUNCTION public.set_organization_role(TEXT, UUID, TEXT)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_from_organization(TEXT, UUID)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_organization_ownership(TEXT, UUID)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_organization_person(TEXT, UUID)          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_organization_role(TEXT, UUID, TEXT)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_from_organization(TEXT, UUID)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_organization_ownership(TEXT, UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_person(TEXT, UUID)          TO authenticated, service_role;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(expected, ', ')
  INTO missing
  FROM unnest(ARRAY[
    'set_organization_role',
    'remove_from_organization',
    'transfer_organization_ownership',
    'get_organization_person'
  ]) AS expected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'CG-023 incomplete — missing function(s): %', missing;
  END IF;
END $$;
