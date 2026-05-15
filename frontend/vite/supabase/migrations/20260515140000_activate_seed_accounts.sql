-- Activate seed accounts: set password, confirm email, insert missing auth.identities
-- Only affects accounts with email LIKE 'seed-%'

-- Step 1: Update auth.users — set password to 123456789, confirm email, set metadata
-- GoTrue (Go) scans string columns with database/sql string (not *string),
-- so NULL token columns crash with "converting NULL to string is unsupported".
-- All string token/change columns must be '' not NULL.
UPDATE auth.users
SET
  encrypted_password = crypt('123456789', gen_salt('bf', 10)),
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb,
  raw_user_meta_data = jsonb_build_object(
    'sub', id::text,
    'email', email,
    'email_verified', true,
    'phone_verified', false
  ),
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  email_change = COALESCE(email_change, ''),
  phone_change = COALESCE(phone_change, ''),
  updated_at = now()
WHERE email LIKE 'seed-%';

-- Step 2: Insert missing auth.identities rows (skip if already exists)
-- Note: email column is generated on production, omit it from INSERT
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  now(),
  u.created_at,
  now()
FROM auth.users u
WHERE u.email LIKE 'seed-%'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- Step 3: Mark profiles as email verified
UPDATE public.profiles
SET email_verified = true
WHERE email LIKE 'seed-%'
  AND email_verified = false;
