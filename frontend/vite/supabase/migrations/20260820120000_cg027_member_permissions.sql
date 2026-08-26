-- ============================================
-- CG-027: MEMBER READ ACCESS + PER-MEMBER PERMISSIONS
-- ============================================
-- A `member` cannot presently use the product at all, and the failure looks like
-- a broken organization rather than a permission denial:
--
--   * `entities` SELECT is is_admin_or_owner (CG entities migration, Phase 1), so
--     a member reads zero entity rows and Page_Templates renders "This
--     organization isn't ready for templates yet — missing its workspace record".
--     The workspace is fine; they simply cannot see it.
--   * `contract_templates` SELECT is is_admin_or_owner, so the templates list and
--     the composer's template picker are permanently empty.
--   * `signature_requests` SELECT is is_org_member, so a member DOES see the
--     document list and a document's detail page — but the PDF comes from the
--     `envelopes_document-url` edge function, whose gate is admin/owner. Read and
--     list disagreed, and the page showed "Only admins and owners can manage
--     documents" for a document the member had themselves signed.
--
-- Two things change here. First, SELECT on entities and contract_templates opens
-- to any org member: a member is now read-only across the organization rather
-- than blind to it. Second, WRITE stops being a property of the tier.
--
-- WHY COLUMNS ON `members` AND NOT A PERMISSIONS TABLE. CG-003 deleted an
-- `organization_role_permissions` matrix with an `app_permission` enum because
-- nothing read it and it made every policy a join. Re-introducing it to hold two
-- booleans would repeat that. `admins` and `members` are already one-table-per-
-- tier, so "what may this member do" belongs on their tier row: one lookup, no
-- join, and a member's grants are deleted with them by the existing cascade.
--
-- Owners and admins are never rows in `members`, so they have no flags to set.
-- has_org_permission() answers true for them unconditionally — the flags are the
-- member tier's business and the People drawer renders them locked-on above it.
-- ============================================

-- --------------------------------------------
-- PHASE 1: THE COLUMNS
-- --------------------------------------------
-- Default false, so an accepted invitation lands read-only and access is granted
-- deliberately afterwards. NOT NULL because "unset" and "denied" are the same
-- answer and a nullable boolean in an RLS predicate is a three-valued trap.
ALTER TABLE public.members
    ADD COLUMN IF NOT EXISTS can_manage_templates boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_send_documents   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.members.can_manage_templates IS
    'CG-027: may create, edit, archive and delete contract templates. Implied for admins and owners.';
COMMENT ON COLUMN public.members.can_send_documents IS
    'CG-027: may create, send, remind, void and cancel signature requests. Implied for admins and owners.';

-- --------------------------------------------
-- PHASE 2: has_org_permission(org_id, perm)
-- --------------------------------------------
-- The third member of the is_org_member / is_admin_or_owner family and written
-- to the same shape: SECURITY DEFINER, reads auth.uid() itself, takes the
-- organization as a parameter because a caller belongs to several.
--
-- An unknown `perm` returns false rather than raising. This is called from RLS,
-- where an exception surfaces to the user as an opaque database error; a typo in
-- a policy should deny, loudly in review, not crash a page.
CREATE OR REPLACE FUNCTION public.has_org_permission(org_id TEXT, perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_id uuid;
  granted   boolean;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RETURN false;
  END IF;

  -- Owner and admin first: they hold every permission by virtue of the tier and
  -- have no `members` row to carry a flag on.
  IF public.is_admin_or_owner(org_id) THEN
    RETURN true;
  END IF;

  SELECT CASE perm
           WHEN 'manage_templates' THEN m.can_manage_templates
           WHEN 'send_documents'   THEN m.can_send_documents
           ELSE false
         END
    INTO granted
  FROM public.members m
  WHERE m.organization_id = org_id AND m.user_id = caller_id;

  RETURN coalesce(granted, false);
END;
$function$;

COMMENT ON FUNCTION public.has_org_permission(TEXT, TEXT) IS
    'CG-027: true when the caller may perform `perm` in `org_id`. Owners and admins always true; members per their flags.';

-- --------------------------------------------
-- PHASE 3: RLS REALIGNMENT
-- --------------------------------------------
-- Policies cannot be re-predicated in place, so each is dropped and recreated.
-- The names change with the predicate: a policy called `admin_or_owner_can_*`
-- that admits a permitted member is a lie the next reader has to discover.

-- entities: SELECT opens to every member. Writes stay admin/owner — an entity is
-- organization structure, not document work, and nothing in CG-027 grants it.
DROP POLICY IF EXISTS "Admin or owner can view entities" ON public.entities;

CREATE POLICY "org_members_can_view_entities"
    ON public.entities FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

-- contract_templates: SELECT to every member (a member sending a document needs
-- to pick one, and a member who cannot send still benefits from seeing what the
-- organization uses). Writes move to the permission.
DROP POLICY IF EXISTS "admin_or_owner_can_view_contract_templates"   ON public.contract_templates;
DROP POLICY IF EXISTS "admin_or_owner_can_insert_contract_templates" ON public.contract_templates;
DROP POLICY IF EXISTS "admin_or_owner_can_update_contract_templates" ON public.contract_templates;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_contract_templates" ON public.contract_templates;

CREATE POLICY "org_members_can_view_contract_templates"
    ON public.contract_templates FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "template_managers_can_insert_contract_templates"
    ON public.contract_templates FOR INSERT TO authenticated
    WITH CHECK (public.has_org_permission(organization_id, 'manage_templates'));

CREATE POLICY "template_managers_can_update_contract_templates"
    ON public.contract_templates FOR UPDATE TO authenticated
    USING (public.has_org_permission(organization_id, 'manage_templates'));

CREATE POLICY "template_managers_can_delete_contract_templates"
    ON public.contract_templates FOR DELETE TO authenticated
    USING (public.has_org_permission(organization_id, 'manage_templates'));

-- signature_requests / signature_request_signers: SELECT already admitted every
-- member and is left alone. Writes move to the permission, keeping the state
-- qualifiers exactly as AHR-2100 set them — a request is still only deletable
-- while `draft`, and signer rows still only mutable while `pending`. Those
-- guard the audit trail and have nothing to do with who is acting.
DROP POLICY IF EXISTS "admin_or_owner_can_insert_signature_requests" ON public.signature_requests;
DROP POLICY IF EXISTS "admin_or_owner_can_update_signature_requests" ON public.signature_requests;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_signature_requests" ON public.signature_requests;

CREATE POLICY "senders_can_insert_signature_requests"
    ON public.signature_requests FOR INSERT TO authenticated
    WITH CHECK (public.has_org_permission(organization_id, 'send_documents'));

CREATE POLICY "senders_can_update_signature_requests"
    ON public.signature_requests FOR UPDATE TO authenticated
    USING (public.has_org_permission(organization_id, 'send_documents'));

CREATE POLICY "senders_can_delete_signature_requests"
    ON public.signature_requests FOR DELETE TO authenticated
    USING (public.has_org_permission(organization_id, 'send_documents') AND status = 'draft');

DROP POLICY IF EXISTS "admin_or_owner_can_insert_signature_request_signers" ON public.signature_request_signers;
DROP POLICY IF EXISTS "admin_or_owner_can_update_signature_request_signers" ON public.signature_request_signers;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_signature_request_signers" ON public.signature_request_signers;

CREATE POLICY "senders_can_insert_signature_request_signers"
    ON public.signature_request_signers FOR INSERT TO authenticated
    WITH CHECK (public.has_org_permission(organization_id, 'send_documents'));

CREATE POLICY "senders_can_update_signature_request_signers"
    ON public.signature_request_signers FOR UPDATE TO authenticated
    USING (public.has_org_permission(organization_id, 'send_documents') AND status = 'pending');

CREATE POLICY "senders_can_delete_signature_request_signers"
    ON public.signature_request_signers FOR DELETE TO authenticated
    USING (public.has_org_permission(organization_id, 'send_documents') AND status = 'pending');

-- --------------------------------------------
-- PHASE 4: set_member_permissions(org_id, target_user_id, ...)
-- --------------------------------------------
-- A SECURITY DEFINER RPC rather than a direct UPDATE from the browser, matching
-- CG-023. `members` has no UPDATE policy admitting an admin to somebody else's
-- row, and adding one would let a permitted member edit their own flags — the
-- exact escalation the feature exists to prevent. Inside a definer function the
-- caller is checked once and cannot be the target's own grant authority.
--
-- Both flags are passed on every call. A partial update would need three-valued
-- arguments to distinguish "leave alone" from "revoke", and the drawer that
-- calls this always holds both switches anyway.
CREATE OR REPLACE FUNCTION public.set_member_permissions(
  org_id                   text,
  target_user_id           uuid,
  p_can_manage_templates   boolean,
  p_can_send_documents     boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id   uuid;
  caller_role text;
  org_owner   uuid;
  updated     integer;
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
  IF caller_role IS NULL OR caller_role = 'member' THEN
    RAISE EXCEPTION 'Only an admin or the owner can change permissions';
  END IF;

  -- Checked before the UPDATE so the owner and admins get the explanatory
  -- message rather than "That person is not a member of this organization",
  -- which is true of the `members` table but reads as though they were absent.
  IF target_user_id = org_owner
     OR EXISTS (SELECT 1 FROM public.admins
                WHERE organization_id = org_id AND user_id = target_user_id) THEN
    RAISE EXCEPTION 'Admins and owners already have every permission';
  END IF;

  UPDATE public.members
  SET can_manage_templates = p_can_manage_templates,
      can_send_documents   = p_can_send_documents,
      updated_at           = now()
  WHERE organization_id = org_id AND user_id = target_user_id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'That person is not in this organization';
  END IF;

  RETURN json_build_object(
    'status',               'updated',
    'can_manage_templates', p_can_manage_templates,
    'can_send_documents',   p_can_send_documents
  );
END;
$$;

-- --------------------------------------------
-- PHASE 5: READING PERMISSIONS BACK
-- --------------------------------------------
-- get_my_org_capabilities: what the CALLER may do here, in one round trip.
-- Every gated control in the UI reads this, so it must not cost two RPCs — the
-- role alone is no longer enough to render a page and asking for role and flags
-- separately would put two queries behind every button.
--
-- Returns role NULL with both flags false for a non-member rather than raising:
-- it is called on pages that render during the brief window before the route
-- guard redirects, and a thrown error there is a console full of noise.
CREATE OR REPLACE FUNCTION public.get_my_org_capabilities(org_id TEXT)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  manage      boolean := false;
  send        boolean := false;
BEGIN
  caller_role := public.get_organization_role(org_id);

  IF caller_role IN ('owner', 'admin') THEN
    manage := true;
    send   := true;
  ELSIF caller_role = 'member' THEN
    SELECT m.can_manage_templates, m.can_send_documents
      INTO manage, send
    FROM public.members m
    WHERE m.organization_id = org_id AND m.user_id = auth.uid();
  END IF;

  RETURN json_build_object(
    'role',                 caller_role,
    'can_manage_templates', coalesce(manage, false),
    'can_send_documents',   coalesce(send, false)
  );
END;
$$;

-- get_organization_person gains the two flags so the drawer needs no second
-- call. Rewritten whole rather than patched: CREATE OR REPLACE cannot add to a
-- json_build_object, and a copy that drifts from CG-023 would be worse than a
-- restatement. The only changes are the two new keys and the two new locals.
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
    'joined_at',  joined_at,
    -- CG-027. True for owners and admins, who have no `members` row to read a
    -- flag from and hold every permission by tier — the drawer renders their
    -- switches on and disabled, which would otherwise show as denied.
    'can_manage_templates', person_role <> 'member' OR coalesce(m.can_manage_templates, false),
    'can_send_documents',   person_role <> 'member' OR coalesce(m.can_send_documents, false)
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
-- can reach it, in the file that creates it. None of these answer anything
-- before sign-in, so anon is revoked from all three.
REVOKE EXECUTE ON FUNCTION public.has_org_permission(TEXT, TEXT)                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_member_permissions(TEXT, UUID, BOOLEAN, BOOLEAN)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_org_capabilities(TEXT)                           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_org_permission(TEXT, TEXT)                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_member_permissions(TEXT, UUID, BOOLEAN, BOOLEAN)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_org_capabilities(TEXT)                           TO authenticated, service_role;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
  v_missing TEXT;
  v_stale   TEXT;
BEGIN
  SELECT string_agg(c, ', ')
    INTO v_missing
  FROM unnest(ARRAY['can_manage_templates', 'can_send_documents']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members' AND column_name = c
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'CG-027: members is missing column(s): %', v_missing;
  END IF;

  -- The whole point of Phase 3 is that a member can READ. If any of these four
  -- still admits only admins, the screenshots that prompted CG-027 come back.
  SELECT string_agg(format('%s.%s', tablename, policyname), E'\n  ')
    INTO v_stale
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
    AND tablename IN ('entities', 'contract_templates')
    AND qual LIKE '%is_admin_or_owner%';

  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'CG-027: SELECT still admin-gated on: %', v_stale;
  END IF;

  IF to_regprocedure('public.has_org_permission(text, text)') IS NULL
     OR to_regprocedure('public.set_member_permissions(text, uuid, boolean, boolean)') IS NULL
     OR to_regprocedure('public.get_my_org_capabilities(text)') IS NULL THEN
    RAISE EXCEPTION 'CG-027: one or more functions were not created';
  END IF;

  RAISE NOTICE 'CG-027 verified: member read access opened, permission flags live.';
END $$;
