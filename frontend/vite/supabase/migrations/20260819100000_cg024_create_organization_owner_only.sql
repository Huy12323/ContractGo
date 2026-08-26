-- ============================================
-- CG-024: CREATE_ORGANIZATION SEEDS THE OWNER ONLY
-- ============================================
-- CG-023 stated the membership invariant: the owner is a COLUMN on
-- `organizations`, not a row in a tier table, and a user holds exactly one tier
-- per organization. `create_organization` never got the memo — it has been
-- inserting the creator into `admins` on top of setting `owner_id` since
-- 20260406211234, so every owner has held two tiers from the moment they
-- clicked Create.
--
-- The visible symptom is the People page: it builds the owner row from
-- `organizations.owner_id` and the admin rows from `admins`, with no dedup and
-- the same `user-<id>` React key for both. The owner is listed twice.
--
-- The rest of the codebase already assumes the invariant. `get_organization_role`
-- checks `owner_id` first and never reaches the `admins` branch for an owner;
-- `is_admin_or_owner` and `get_my_member_organizations` check both sources
-- independently; `get_organization_person` special-cases the owner; and the
-- send-invitation edge function carries the comment "The owner is not in
-- `admins` by definition of the membership model" next to the extra lookup it
-- has to do because of it. Nothing reads the phantom row on purpose.
--
-- This is the same surgery AHR-556 (20260410133909) performed on the sibling
-- `employees` insert in this exact function, for the same reason.
-- ============================================

-- --------------------------------------------
-- PHASE 1: Drop the admins insert from the RPC
-- --------------------------------------------
-- Signature is unchanged, so the CG-010 REVOKE/GRANT allow-list entries for
-- create_organization(TEXT) still stand and are not restated here.
CREATE OR REPLACE FUNCTION public.create_organization(org_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  new_org_id text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- `owner_id` IS the membership. No tier row.
  INSERT INTO public.organizations (name, owner_id)
  VALUES (org_name, caller_id)
  RETURNING id INTO new_org_id;

  RETURN new_org_id;
END;
$$;

-- --------------------------------------------
-- PHASE 2: Clean up the phantom owner-admin rows
-- --------------------------------------------
-- Narrowly scoped the way AHR-556 phase 2 was: only rows where the admin IS the
-- owner of that same organization. A user who owns org A and is a genuine admin
-- of org B keeps the org B row.
DELETE FROM public.admins a
USING public.organizations o
WHERE a.organization_id = o.id
  AND a.user_id = o.owner_id;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
-- SELECT count(*) FROM public.admins a
-- JOIN public.organizations o ON o.id = a.organization_id
-- WHERE a.user_id = o.owner_id;   -- expect 0
