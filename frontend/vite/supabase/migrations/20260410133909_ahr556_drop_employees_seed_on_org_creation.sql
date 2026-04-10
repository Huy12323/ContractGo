-- ============================================
-- AHR-556: DROP EMPLOYEES SEED ON ORG CREATION
-- ============================================
-- The original create_organization RPC seeded the caller into THREE tables:
-- organizations (owner_id), admins, AND employees. The employees row was empty
-- (no email, no name, no birthday) and polluted the directory + caused the
-- AHR-497 send-invitation duplicate guard to bypass owners (the empty `email`
-- column didn't match an ilike check).
--
-- After this migration, owners are seeded into organizations.owner_id + admins
-- only. To appear in the employee directory, an admin/owner must go through
-- the regular onboarding flow (covered separately under AHR-465 / AHR-557).
-- ============================================

-- PHASE 1: Patch the RPC to drop the employees insert
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

  INSERT INTO public.organizations (name, owner_id)
  VALUES (org_name, caller_id)
  RETURNING id INTO new_org_id;

  INSERT INTO public.admins (user_id, organization_id)
  VALUES (caller_id, new_org_id);

  RETURN new_org_id;
END;
$$;

-- PHASE 2: Cleanup phantom employees rows
-- Narrowly scoped: only delete rows that are clearly the owner-as-phantom seed
-- (user_id matches the org's owner_id AND email is empty). Real employee rows
-- with populated emails are preserved even if a user happens to be both the
-- owner of one org and a real employee of another.
DELETE FROM public.employees e
USING public.organizations o
WHERE e.organization_id = o.id
  AND e.user_id = o.owner_id
  AND e.email = '';
