-- ============================================
-- CG-021: INVITATION RPCs, ROLE-AWARE
-- ============================================
-- Rewrites the three SECURITY DEFINER functions that read the invitations table
-- against its new name (CG-020) and its new `role` column.
--
-- `accept_invitation` keeps every validation it already had — exists, still
-- pending, not expired, case-insensitive email match against auth.users — and
-- gains exactly one thing: a branch on `role`. That branch is the whole feature;
-- everything else here is a table rename following through.
-- ============================================

-- --------------------------------------------
-- has_pending_invitation(org_id)
-- --------------------------------------------
-- Powers the "Invitees can view invited organizations" policy on
-- public.organizations, which is how Page_Invitation renders an org name for
-- someone who is not a member yet. Logic unchanged; table name is not.
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
    SELECT 1 FROM public.invitations
    WHERE organization_id = org_id
      AND lower(email) = lower(caller_email)
      AND status = 'pending'
      AND expires_at > now()
  );
END;
$$;

-- --------------------------------------------
-- get_invitation_by_token(token)
-- --------------------------------------------
-- Keeps its `anon` grant: the invitee reads this from the emailed link BEFORE
-- signing in, which is the entire point of the token. It exposes an org name
-- and an email that the holder of the token already knows.
--
-- Now returns `role`, so Page_Invitation can say "as an Admin" / "as a Member"
-- instead of the hard-coded "as an admin" it said when only one tier existed.
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
    'role', i.role,
    'status', i.status,
    'expires_at', i.expires_at,
    'created_at', i.created_at,
    'organization_name', o.name,
    'organization_id', o.id,
    'expired', i.expires_at < now()
  ) INTO result
  FROM public.invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = invitation_token;

  RETURN result;
END;
$$;

-- --------------------------------------------
-- accept_invitation(token)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_invitation(invitation_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv           record;
  caller_id     uuid;
  caller_email  text;
  already_there boolean;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller_id;

  SELECT * INTO inv
  FROM public.invitations
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

  -- The token alone is not enough. Whoever opens the link must be signed in as
  -- the address it was sent to, or forwarding the mail would be a way in.
  IF lower(inv.email) != lower(caller_email) THEN
    RAISE EXCEPTION 'Email mismatch — this invitation was sent to a different address';
  END IF;

  IF inv.role = 'admin' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.admins
      WHERE organization_id = inv.organization_id AND user_id = caller_id
    ) INTO already_there;

    IF NOT already_there THEN
      INSERT INTO public.admins (user_id, organization_id)
      VALUES (caller_id, inv.organization_id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.members
      WHERE organization_id = inv.organization_id AND user_id = caller_id
    ) INTO already_there;

    IF NOT already_there THEN
      -- `entity_id` is left NULL: entities are an HR-era grouping and a
      -- ContractGo organization has none (CG-020 made the column optional for
      -- exactly this insert). `email` is copied from the invitation so the
      -- directory has something to show before the profile is filled in.
      INSERT INTO public.members (user_id, organization_id, email)
      VALUES (caller_id, inv.organization_id, lower(inv.email))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Consumed either way. An invitation to a tier you already hold is not an
  -- error the invitee can act on, and leaving it 'pending' would keep a dead
  -- row on the People page forever.
  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = inv.id;

  RETURN json_build_object(
    'status', CASE
                WHEN already_there AND inv.role = 'admin'  THEN 'already_admin'
                WHEN already_there                          THEN 'already_member'
                ELSE 'accepted'
              END,
    'organization_id', inv.organization_id,
    'role', inv.role
  );
END;
$$;

-- --------------------------------------------
-- GRANTS
-- --------------------------------------------
-- CREATE OR REPLACE preserves existing grants, but these are re-stated so this
-- file is self-describing about which SECURITY DEFINER surface is reachable by
-- whom — the allow-list discipline established in CG-010.
REVOKE EXECUTE ON FUNCTION public.accept_invitation(TEXT)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_pending_invitation(TEXT)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_invitation(TEXT)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.has_pending_invitation(TEXT)   TO authenticated, service_role;

-- Deliberately keeps `anon`: read before sign-in, see the note on the function.
GRANT  EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT)  TO anon, authenticated, service_role;
