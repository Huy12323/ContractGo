-- ============================================
-- AHR-1715 follow-up: RLS for invitation recipients on public.files
-- ============================================
-- Context:
--   * AHR-1715 added `resource_type = 'invitation_col'` on the upload / sign-read-url
--     / delete edge functions with dual auth (invitation recipient OR org admin/owner).
--   * The strip also queries the `files` table directly via useQ_Tables_OrgFiles for
--     filename + content_type + thumbnail_r2_key lookup, and useM_Files_Upload inserts
--     the `files` row from the client after R2 presign.
--   * Existing RLS only allows SELECT/INSERT/UPDATE for `is_org_member` / `is_admin_or_owner` —
--     the employee filling the invitation isn't a member yet (placement runs post-submit),
--     so their queries return empty and cards stall on a spinner.
--
-- Fix:
--   * Add a SELECT + INSERT + UPDATE policy that grants access to invitation recipients
--     for files whose r2_key lives under their invitation's scope:
--         orgs/{org_id}/invitations/{invitation_id}/{column_id}/{filename}
--     The invitation_id is extracted via split_part(r2_key, '/', 4).
--   * `is_invitation_recipient(invitation_id)` helper checks whether auth.jwt() ->> 'email'
--     matches onboarding_invitations.employee_email (case-insensitive, trimmed). Mirrors
--     the dual-auth logic in the edge functions so the layers agree.
--   * DELETE is unchanged — deletes happen via the files_r2_delete edge function (service
--     role, bypasses RLS), never from the client.
-- ============================================

-- PHASE 1: Helper — is_invitation_recipient
CREATE OR REPLACE FUNCTION public.is_invitation_recipient(p_invitation_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.onboarding_invitations inv
    WHERE inv.id = p_invitation_id
      AND lower(trim(inv.employee_email))
        = lower(trim(COALESCE((auth.jwt() ->> 'email')::text, '')))
  );
$$;

-- PHASE 2: SELECT — let invitation recipients read files in their invitation scope
CREATE POLICY "invitation_recipients_can_view_invitation_files"
ON public.files
FOR SELECT
TO authenticated
USING (
  r2_key LIKE 'orgs/%/invitations/%/%/%'
  AND public.is_invitation_recipient(split_part(r2_key, '/', 4))
);

-- PHASE 3: INSERT — let invitation recipients write files to their invitation scope
-- (required because useM_Files_Upload does client-side insert after R2 PUT)
CREATE POLICY "invitation_recipients_can_insert_invitation_files"
ON public.files
FOR INSERT
TO authenticated
WITH CHECK (
  r2_key LIKE 'orgs/%/invitations/%/%/%'
  AND public.is_invitation_recipient(split_part(r2_key, '/', 4))
);

-- PHASE 4: UPDATE — let invitation recipients patch thumbnail_r2_key on their own files
-- (useM_Files_Upload does a follow-up UPDATE to write the thumbnail pointer after
--  generating the client-side thumbnail)
CREATE POLICY "invitation_recipients_can_update_invitation_files"
ON public.files
FOR UPDATE
TO authenticated
USING (
  r2_key LIKE 'orgs/%/invitations/%/%/%'
  AND public.is_invitation_recipient(split_part(r2_key, '/', 4))
)
WITH CHECK (
  r2_key LIKE 'orgs/%/invitations/%/%/%'
  AND public.is_invitation_recipient(split_part(r2_key, '/', 4))
);
