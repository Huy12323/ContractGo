-- ===========================================================================
-- CG-028 — GOOGLE SIGN-IN: PROFILE SEEDING FOR OAUTH IDENTITIES
-- ===========================================================================
--
-- `handle_new_user` was written for one signup shape: email + password, where
-- the client controls `raw_user_meta_data` and puts `full_name` in it. A Google
-- signup has a different shape, and the function silently produced a worse row
-- for it in two ways:
--
--   1. NAMING. Google's OIDC claims land as `name` and `picture`. The function
--      read `full_name` and `avatar_url`, so a Google account got a profile with
--      a NULL name — which is the string every member list, envelope actor and
--      audit payload in the app renders.
--
--   2. VERIFICATION. `profiles.email_verified` defaults to false, and
--      `_protected`'s guard bounces false to /verify-email. A Google user has no
--      password and never asked for a verification email, so that is a dead end:
--      the only way out of the screen is a resend they cannot act on. Meanwhile
--      the provider has ALREADY verified the address — that is the entire point
--      of the identity — so the CG-006 loop has nothing left to prove.
--
-- Scope note: this is the only gate that moves. The CG-027 whitelist is
-- untouched, so a Google account still lands on /pending-access until someone
-- adds the address to `public.whitelist`. Verified and approved are different
-- questions and this migration only answers the first.
--
-- Not backfilled. Every existing profile row predates Google being enabled, so
-- there is no OAuth account whose `email_verified` is wrong to correct.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, phone, email_verified)
  values (
    new.id,
    new.email,
    -- `full_name` first: it is what our own signup form writes, and where a
    -- caller's explicit intent lives. `name` is Google's claim, the fallback.
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    ),
    -- Unchanged from CG-016. The verified column wins over the metadata the
    -- client sent, and both are normalized to NULL rather than '' — `auth.users.phone`
    -- is '' for the email-only signups that are the norm here, and an empty
    -- string in an evidence payload reads as "recorded as blank" instead of
    -- "not recorded".
    nullif(coalesce(nullif(new.phone, ''), new.raw_user_meta_data ->> 'phone'), ''),
    -- Two conditions, both required. `provider <> 'email'` alone would hand a
    -- free pass to every provider ever enabled on this project, including one
    -- added years from now by someone who never read this line; the second
    -- clause makes the provider assert the verification rather than us assuming
    -- it. Google sets `email_verified` in the claims it returns.
    coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email'
      and coalesce((new.raw_user_meta_data ->> 'email_verified')::boolean, false)
  );
  return new;
end;
$$;

-- CG-010 lockdown, re-applied. CREATE OR REPLACE resets the function's ACL to
-- the default (EXECUTE to PUBLIC), so omitting this would quietly re-open a
-- SECURITY DEFINER function that writes to `profiles` to anon and authenticated.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
    'Seeds public.profiles from a new auth.users row. Reads both our own signup '
    'metadata (full_name/avatar_url) and Google OIDC claims (name/picture), and '
    'pre-marks email_verified for identities a provider has already verified '
    '(CG-028). Trigger-only: EXECUTE is revoked from PUBLIC/anon/authenticated.';
