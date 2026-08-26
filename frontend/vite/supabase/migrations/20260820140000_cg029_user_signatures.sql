-- ============================================
-- CG-029: SAVED SIGNATURE LIBRARY
-- ============================================
-- A signer re-creates their mark from scratch on every document. The capture UI
-- (`App_SignatureCapture`) already supports draw / type / upload, but the result
-- is a throwaway data URL: it is submitted as `signature_base64`, burned into the
-- PDF, and never seen again. Someone signing their tenth contract redraws their
-- signature a tenth time.
--
-- This table is that mark, kept.
--
-- WHAT THIS TABLE IS NOT. It is not the legal record and it is not evidence.
-- `signature_captures` remains the write-once, one-row-per-signing-event artifact
-- with its own SHA-256 and its own hash-chained audit entry, and `signing_submit`
-- is not changed by this migration at all. Choosing a saved signature only
-- pre-fills the same `signature_base64` the signer would otherwise have drawn —
-- the server still decodes it, hashes it, stores it and chains it exactly as
-- before. If this table were dropped tomorrow, every executed document would
-- still be provable. That separation is the whole design: convenience on one
-- side of the line, evidence on the other, and nothing reaching across.
--
-- WHY NO organization_id, breaking the RLS convention. Every org-scoped table
-- here carries `organization_id TEXT NOT NULL` populated by a BEFORE INSERT
-- trigger, and policies go through is_org_member() / is_admin_or_owner(). A
-- signature is not an org's property — it is a person's, and that person signs
-- for several organizations with the same hand. This is a user-scoped table like
-- `profiles`, and it uses `auth.uid() = user_id` directly. It is the same
-- reasoning that gives a `user_avatar` upload no `files` row: `files` is
-- org-scoped and a person spans orgs.
--
-- WHY capture_method IS REUSED RATHER THAN EXTENDED. The enum records how a mark
-- was MADE — drawn, typed, or uploaded — which is a fact about the act and does
-- not change because the mark was stored in between. A saved signature therefore
-- carries its original provenance forward into the capture it pre-fills, and
-- there is no 'saved' member: "saved" is where the bytes came from, not how a
-- human produced them, and conflating the two would weaken what the enum means
-- everywhere else it is read.
-- ============================================

-- --------------------------------------------
-- PHASE 1: THE TABLE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_signatures (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Optional. A library of one needs no labels; a library of three ("initials",
    -- "full name") does. NULL renders as a positional fallback in the UI.
    name           TEXT,
    -- `users/{user_id}/signatures/{uuid}.png`. Deliberately NOT the public
    -- `users/{id}/avatar-*` namespace the R2 Worker serves without a token: an
    -- avatar leaking is a photo, a signature leaking is forgeable material. The
    -- Worker gets a matching token-authorized branch in the same change.
    r2_key         TEXT NOT NULL,
    -- Of the stored PNG. Not load-bearing for evidence (the capture computes its
    -- own at signing time, which is the one that counts) — this exists so a
    -- corrupted or swapped object in R2 is detectable.
    sha256         TEXT,
    capture_method public.signature_captures_capture_method_enum NOT NULL,
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_signatures IS
    'CG-029: a user''s reusable signature images. A convenience library, never the legal record — see signature_captures.';
COMMENT ON COLUMN public.user_signatures.r2_key IS
    'CG-029: users/{user_id}/signatures/{uuid}.png. Token-authorized on the Worker, unlike the public avatar namespace.';
COMMENT ON COLUMN public.user_signatures.capture_method IS
    'CG-029: how the mark was originally made. Carried forward into the signature_captures row it pre-fills.';

-- The library is always read whole and filtered by owner, so one index on
-- user_id covers every query the UI makes.
CREATE INDEX IF NOT EXISTS user_signatures_user_id_idx
    ON public.user_signatures (user_id);

-- At most one default per user, enforced by the database rather than by whoever
-- remembers to clear the old one. Partial, because "not the default" is the
-- common case and must not be unique.
--
-- NOTE for anything that flips the default: this index is NOT deferrable (a
-- partial index cannot be a deferrable constraint), so it is checked row by row.
-- Clearing and setting in one multi-row UPDATE can therefore trip it mid-
-- statement depending on row order. `set_default_signature()` below exists to
-- make that impossible to get wrong.
CREATE UNIQUE INDEX IF NOT EXISTS user_signatures_one_default
    ON public.user_signatures (user_id)
    WHERE is_default;

-- --------------------------------------------
-- PHASE 2: RLS — OWNER ONLY, ALL FOUR VERBS
-- --------------------------------------------
-- Stricter than `profiles`, whose SELECT is `using (true)` so that any
-- authenticated user can render anyone's name and avatar. Nothing in the product
-- needs to read someone else's signature image: the sender sees the mark that
-- was burned into their document, which comes from `signature_captures`, not
-- from here. So SELECT is owner-only too.
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_can_view_own_signatures   ON public.user_signatures;
DROP POLICY IF EXISTS users_can_insert_own_signatures ON public.user_signatures;
DROP POLICY IF EXISTS users_can_update_own_signatures ON public.user_signatures;
DROP POLICY IF EXISTS users_can_delete_own_signatures ON public.user_signatures;

CREATE POLICY users_can_view_own_signatures
    ON public.user_signatures FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY users_can_insert_own_signatures
    ON public.user_signatures FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- WITH CHECK as well as USING: without it a user could update a row they own and
-- set `user_id` to someone else, which passes the USING test on the old row.
CREATE POLICY users_can_update_own_signatures
    ON public.user_signatures FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY users_can_delete_own_signatures
    ON public.user_signatures FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Restating the CG-025 baseline for this table explicitly. The default
-- privileges in `public` were fixed there so new tables inherit the grant, but
-- naming it here means a fresh environment cannot depend on that inheritance
-- holding. `anon` is granted for the same reason CG-025 gives: every policy above
-- names `authenticated`, so anon still reads nothing.
GRANT ALL ON TABLE public.user_signatures TO anon, authenticated, service_role;

-- --------------------------------------------
-- PHASE 3: updated_at
-- --------------------------------------------
-- Reuses the trigger function created alongside `profiles`.
DROP TRIGGER IF EXISTS on_user_signature_updated ON public.user_signatures;
CREATE TRIGGER on_user_signature_updated
    BEFORE UPDATE ON public.user_signatures
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------
-- PHASE 4: set_default_signature(signature_id)
-- --------------------------------------------
-- Two statements that must not be observable apart, wrapped so a caller cannot
-- perform only the first. Sequential rather than a single
-- `SET is_default = (id = p_signature_id)` for the reason given on the index
-- above: one multi-row UPDATE can transiently hold two defaults and trip a
-- non-deferrable unique index depending on the order rows are visited.
--
-- SECURITY INVOKER (the default), NOT DEFINER. The RLS policies above already say
-- exactly the right thing, so running as the caller needs no extra checks and
-- adds no surface to the CG-010 allow-list. The `WHERE user_id = auth.uid()`
-- clauses are therefore belt-and-braces over RLS, not the enforcement.
CREATE OR REPLACE FUNCTION public.set_default_signature(p_signature_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    UPDATE public.user_signatures
       SET is_default = FALSE
     WHERE user_id = auth.uid()
       AND is_default;

    UPDATE public.user_signatures
       SET is_default = TRUE
     WHERE id = p_signature_id
       AND user_id = auth.uid();

    -- RLS makes someone else's row invisible rather than forbidden, so a wrong id
    -- and a stolen id look identical here: zero rows updated. Failing loudly
    -- keeps the UI from reporting success after changing nothing.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Signature % not found', p_signature_id
            USING ERRCODE = 'no_data_found';
    END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_default_signature(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_signature(UUID) TO authenticated;

-- --------------------------------------------
-- PHASE 5: REALTIME
-- --------------------------------------------
-- Matches `profiles`. The library is edited in Settings and read on the signing
-- screen, which can be two tabs open at once.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_signatures;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_policies int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'user_signatures'
           AND relnamespace = 'public'::regnamespace
           AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'CG-029: RLS is not enabled on user_signatures';
    END IF;

    SELECT count(*) INTO v_policies
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_signatures';

    IF v_policies <> 4 THEN
        RAISE EXCEPTION 'CG-029: expected 4 policies on user_signatures, found %', v_policies;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'user_signatures_one_default'
    ) THEN
        RAISE EXCEPTION 'CG-029: the one-default-per-user index is missing';
    END IF;

    RAISE NOTICE 'CG-029: user_signatures created.';
END $$;
