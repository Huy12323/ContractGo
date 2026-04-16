-- ============================================
-- AHR-688: GET INVITATION PREVIEW RPC
-- ============================================
-- Returns minimal metadata for an onboarding invitation by token,
-- bypassing RLS. Used by Page_OnboardingFiller to distinguish
-- "different account needed", "already accepted", and "no longer
-- available" error states from a genuinely invalid token.
--
-- Security notes:
-- - SECURITY DEFINER — bypasses the invitee-facing RLS policy which
--   requires email match. The caller must still be authenticated.
-- - Returned fields are a narrow projection: employee_email,
--   organization_name, and status. No prefilled answers, no contract
--   layout, no department data leak.
-- - Token is a 128-bit UUID (gen_random_uuid), so enumeration is
--   impractical.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token TEXT)
RETURNS TABLE(
    employee_email TEXT,
    organization_name TEXT,
    status public.onboarding_invitations_status_enum
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT i.employee_email, o.name AS organization_name, i.status
    FROM public.onboarding_invitations i
    JOIN public.organizations o ON o.id = i.organization_id
    WHERE i.invitation_token = p_token
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_invitation_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(TEXT) TO authenticated;
