-- ============================================
-- RENAME ORG_ MEMBERSHIP TABLES
-- org_admins → admins
-- org_employees → employees
-- org_admin_invitations → admin_invitations
-- ============================================

-- PHASE 1: RENAME TABLES
ALTER TABLE public.org_admins RENAME TO admins;
ALTER TABLE public.org_employees RENAME TO employees;
ALTER TABLE public.org_admin_invitations RENAME TO admin_invitations;

-- PHASE 2: DROP ALL RLS POLICIES ON RENAMED TABLES
-- admins (formerly org_admins)
DROP POLICY IF EXISTS "Members can view org admins" ON public.admins;
DROP POLICY IF EXISTS "Owner can add admins" ON public.admins;
DROP POLICY IF EXISTS "Owner can remove admins" ON public.admins;

-- employees (formerly org_employees)
DROP POLICY IF EXISTS "Members can view org employees" ON public.employees;
DROP POLICY IF EXISTS "Admin or owner can add employees" ON public.employees;
DROP POLICY IF EXISTS "Admin or owner can remove employees" ON public.employees;

-- admin_invitations (formerly org_admin_invitations)
DROP POLICY IF EXISTS "Owner can view org invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Owner can delete org invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Invitee can view own invitations" ON public.admin_invitations;
DROP POLICY IF EXISTS "Invitee can update own invitations" ON public.admin_invitations;

-- PHASE 3: DROP AND RECREATE RLS HELPER FUNCTIONS
-- (must drop CASCADE since policies on OTHER tables depend on them)

DROP FUNCTION IF EXISTS public.is_org_member(text) CASCADE;
DROP FUNCTION IF EXISTS public.get_organization_role(text) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin_or_owner(text) CASCADE;
DROP FUNCTION IF EXISTS public.has_pending_invitation(text) CASCADE;

-- is_org_member: check owner_id, admins, employees
CREATE OR REPLACE FUNCTION public.is_org_member(org_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  RETURN EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id AND owner_id = caller_id
  )
  OR EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = org_id AND user_id = caller_id
  )
  OR EXISTS (
    SELECT 1 FROM public.employees
    WHERE organization_id = org_id AND user_id = caller_id
  );
END;
$$;

-- get_organization_role: returns 'owner', 'admin', 'employee', or null
CREATE OR REPLACE FUNCTION public.get_organization_role(org_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id AND owner_id = caller_id
  ) THEN
    RETURN 'owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = org_id AND user_id = caller_id
  ) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE organization_id = org_id AND user_id = caller_id
  ) THEN
    RETURN 'employee';
  END IF;

  RETURN NULL;
END;
$$;

-- is_admin_or_owner: check owner_id or admins
CREATE OR REPLACE FUNCTION public.is_admin_or_owner(org_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  RETURN EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id AND owner_id = caller_id
  )
  OR EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = org_id AND user_id = caller_id
  );
END;
$$;

-- has_pending_invitation: check admin_invitations for pending invite
CREATE OR REPLACE FUNCTION public.has_pending_invitation(org_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
BEGIN
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();

  RETURN EXISTS (
    SELECT 1 FROM public.admin_invitations
    WHERE organization_id = org_id
      AND lower(email) = lower(caller_email)
      AND status = 'pending'
      AND expires_at > now()
  );
END;
$$;

-- PHASE 4: RECREATE RLS POLICIES ON RENAMED TABLES

-- admins
CREATE POLICY "Members can view admins"
  ON public.admins FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "Owner can add admins"
  ON public.admins FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = admins.organization_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Owner can remove admins"
  ON public.admins FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = admins.organization_id AND owner_id = auth.uid()
    )
  );

-- employees
CREATE POLICY "Members can view employees"
  ON public.employees FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "Admin or owner can add employees"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can remove employees"
  ON public.employees FOR DELETE TO authenticated
  USING (is_admin_or_owner(organization_id));

-- admin_invitations
CREATE POLICY "Owner can view invitations"
  ON public.admin_invitations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = admin_invitations.organization_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Owner can delete invitations"
  ON public.admin_invitations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = admin_invitations.organization_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Invitee can view own invitations"
  ON public.admin_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));

CREATE POLICY "Invitee can update own invitations"
  ON public.admin_invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email'));

-- PHASE 5: RECREATE POLICIES ON OTHER TABLES (dropped by CASCADE)

-- organizations
CREATE POLICY "Members can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (is_org_member(id));

CREATE POLICY "Only owner can update organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (get_organization_role(id) = 'owner')
  WITH CHECK (get_organization_role(id) = 'owner');

CREATE POLICY "Only owner can delete organization"
  ON public.organizations FOR DELETE TO authenticated
  USING (get_organization_role(id) = 'owner');

CREATE POLICY "Invitees can view invited organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (has_pending_invitation(id));

-- entities
CREATE POLICY "Admin or owner can view entities"
  ON public.entities FOR SELECT TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can create entities"
  ON public.entities FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can update entities"
  ON public.entities FOR UPDATE TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can delete entities"
  ON public.entities FOR DELETE TO authenticated
  USING (is_admin_or_owner(organization_id));

-- departments
CREATE POLICY "Admin or owner can view departments"
  ON public.departments FOR SELECT TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can create departments"
  ON public.departments FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can update departments"
  ON public.departments FOR UPDATE TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can delete departments"
  ON public.departments FOR DELETE TO authenticated
  USING (is_admin_or_owner(organization_id));

-- entity_employees
CREATE POLICY "Admin or owner can view entity employees"
  ON public.entity_employees FOR SELECT TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can create entity employees"
  ON public.entity_employees FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can update entity employees"
  ON public.entity_employees FOR UPDATE TO authenticated
  USING (is_admin_or_owner(organization_id));

CREATE POLICY "Admin or owner can delete entity employees"
  ON public.entity_employees FOR DELETE TO authenticated
  USING (is_admin_or_owner(organization_id));

-- PHASE 6: DROP AND RECREATE RPCs

-- Drop old accept_admin_invitation, recreate as accept_invitation
DROP FUNCTION IF EXISTS public.accept_admin_invitation(text);

CREATE OR REPLACE FUNCTION public.accept_invitation(invitation_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  caller_id uuid;
  caller_email text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller_id;

  SELECT * INTO inv
  FROM public.admin_invitations
  WHERE token = invitation_token;

  IF inv IS NULL THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF inv.status != 'pending' THEN
    RAISE EXCEPTION 'Invitation already %', inv.status;
  END IF;

  IF inv.expires_at < now() THEN
    RAISE EXCEPTION 'Invitation has expired';
  END IF;

  IF lower(inv.email) != lower(caller_email) THEN
    RAISE EXCEPTION 'Email mismatch — this invitation was sent to a different address';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = inv.organization_id AND user_id = caller_id
  ) THEN
    UPDATE public.admin_invitations
    SET status = 'accepted'
    WHERE id = inv.id;

    RETURN json_build_object('status', 'already_admin', 'organization_id', inv.organization_id);
  END IF;

  INSERT INTO public.admins (user_id, organization_id)
  VALUES (caller_id, inv.organization_id);

  UPDATE public.admin_invitations
  SET status = 'accepted'
  WHERE id = inv.id;

  RETURN json_build_object('status', 'accepted', 'organization_id', inv.organization_id);
END;
$$;

-- Drop and recreate get_my_member_organizations
DROP FUNCTION IF EXISTS public.get_my_member_organizations();

CREATE OR REPLACE FUNCTION public.get_my_member_organizations()
RETURNS TABLE(id text, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name FROM public.organizations o
  WHERE o.owner_id = auth.uid()
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.admins a ON a.organization_id = o.id
  WHERE a.user_id = auth.uid()
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.employees e ON e.organization_id = o.id
  WHERE e.user_id = auth.uid()
$$;

-- Drop and recreate create_organization (inserts into admins + employees)
DROP FUNCTION IF EXISTS public.create_organization(text);

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

  INSERT INTO public.employees (user_id, organization_id)
  VALUES (caller_id, new_org_id);

  RETURN new_org_id;
END;
$$;

-- Fix get_invitation_by_token (still references old table name)
DROP FUNCTION IF EXISTS public.get_invitation_by_token(text);

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(invitation_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'id', i.id,
    'email', i.email,
    'status', i.status,
    'expires_at', i.expires_at,
    'created_at', i.created_at,
    'organization_name', o.name,
    'organization_id', o.id,
    'expired', i.expires_at < now()
  ) INTO result
  FROM public.admin_invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = invitation_token;

  RETURN result;
END;
$$;
