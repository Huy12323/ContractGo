-- ============================================
-- Self-managed email verification & recovery
-- ============================================
-- Supabase enable_confirmations=false — we manage verification ourselves.
-- profiles.email_verified tracks state. auth_tokens stores verification/recovery tokens.

-- PHASE 1: Add email_verified to profiles
ALTER TABLE public.profiles ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;

-- PHASE 2: Auth tokens table
CREATE TABLE public.auth_tokens (
    id TEXT PRIMARY KEY DEFAULT generate_id('atok'),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('verification', 'recovery')),
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_auth_tokens_token ON public.auth_tokens(token);
CREATE INDEX idx_auth_tokens_user_id ON public.auth_tokens(user_id);

-- PHASE 3: RLS — service role only (edge functions use service_role_key)
ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies = only service_role can access (RLS blocks all authenticated/anon)

-- PHASE 4: Cleanup function — delete expired tokens
CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_tokens()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.auth_tokens WHERE expires_at < now();
$$;
