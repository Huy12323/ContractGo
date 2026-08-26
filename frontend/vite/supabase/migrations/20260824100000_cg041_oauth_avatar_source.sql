-- ============================================
-- CG-041: A TRUSTWORTHY SOURCE FOR THE OAUTH AVATAR
-- ============================================
-- CG-042's edge function mirrors a Google profile picture into R2, so that every
-- avatar in the product is an object we hold and a `files` row we can account
-- for — the same treatment template PDFs and signatures already get. To do that
-- it has to FETCH A URL FROM THE SERVER, which makes where that URL comes from a
-- security question rather than a plumbing one.
--
-- The obvious source is wrong. `profiles.avatar_url` is writable by the account
-- holder (the `auth.uid() = id` policy, plus `useM_Profile_Update`), so reading
-- the fetch target from there hands any signed-in user a server-side request
-- forgery primitive: set the column to `http://169.254.169.254/latest/meta-data/`
-- and ask the function to go and get it.
--
-- `raw_user_meta_data` is no better. It looks provider-supplied, but
-- `supabase.auth.updateUser({ data })` writes it, so it is user-controlled too.
--
-- `auth.identities.identity_data` IS provider-supplied. GoTrue writes it from the
-- OIDC claims on each sign-in and there is no API that lets the account holder
-- edit it. That is the source, and this function is how the edge function reaches
-- it — PostgREST exposes only `public`, so the `auth` schema is otherwise
-- unreachable from a function invocation.
--
-- This closes the input side. CG-042 still applies a scheme and host allow-list
-- on what comes back, because "provider-supplied" is a statement about who wrote
-- the value, not about where it points.

CREATE OR REPLACE FUNCTION public.oauth_avatar_source(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT coalesce(
               nullif(i.identity_data ->> 'avatar_url', ''),
               nullif(i.identity_data ->> 'picture', '')
           )
      FROM auth.identities i
     WHERE i.user_id = p_user_id
       -- The email/password identity carries no picture, and excluding it keeps
       -- the ORDER BY below from ever preferring it over a real provider.
       AND i.provider <> 'email'
       AND coalesce(
               nullif(i.identity_data ->> 'avatar_url', ''),
               nullif(i.identity_data ->> 'picture', '')
           ) IS NOT NULL
     -- Most recently linked identity wins, for an account that has more than one.
     ORDER BY i.updated_at DESC NULLS LAST
     LIMIT 1;
$$;

COMMENT ON FUNCTION public.oauth_avatar_source(UUID) IS
    'The provider-supplied avatar URL from auth.identities — the only source for '
    'it that the account holder cannot write. Read by the avatar mirror (CG-042); '
    'service_role only (CG-041).';

-- --------------------------------------------
-- GRANTS
-- --------------------------------------------
-- CG-010 discipline. service_role ONLY: this reads the `auth` schema and takes a
-- user id as an argument, so an `authenticated` grant would let any signed-in
-- user read any other account's linked-identity data one id at a time.
REVOKE EXECUTE ON FUNCTION public.oauth_avatar_source(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_avatar_source(UUID) TO service_role;

DO $$
BEGIN
    IF has_function_privilege('authenticated', 'public.oauth_avatar_source(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-041 incomplete — authenticated holds EXECUTE on oauth_avatar_source()';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.oauth_avatar_source(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-041 incomplete — service_role cannot EXECUTE oauth_avatar_source()';
    END IF;
END $$;
