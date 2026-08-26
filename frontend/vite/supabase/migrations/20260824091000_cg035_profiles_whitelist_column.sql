-- ============================================
-- CG-035: MATERIALIZE WHITELIST STATUS ON profiles
-- ============================================
-- CG-027 made whitelist status answerable only through an RPC, because the table
-- behind it is an operational roster no client may enumerate. That is still true
-- of the roster. It is not true of the one-bit answer for the calling user, and
-- keeping the answer behind a second round trip has a cost the app pays on every
-- navigation: `_protected`'s guard already SELECTs `profiles.email_verified`, and
-- fires `is_whitelisted()` beside it purely because the boolean lives nowhere.
--
-- So the boolean gets a home. `profiles.whitelist` is materialized — set on
-- signup, and recomputed by trigger whenever either input changes (the roster, or
-- the profile's own address).
--
-- WHY NOT A GENERATED COLUMN. `GENERATED ALWAYS AS` may only reference the row it
-- is on; this depends on another table. WHY NOT RLS. RLS filters rows, it cannot
-- compute a column — "managed by RLS" is not a thing a boolean can be. WHY NOT A
-- VIEW. A view would be drift-proof, but it moves every existing `.from('profiles')`
-- callsite in the app onto a new relation to gain one column. Materialization
-- keeps the callsites and moves the risk into two triggers, which is a risk this
-- file can close over.
--
-- The column is READABLE by any authenticated client (profiles' SELECT policy is
-- `using (true)`) and writable by NOBODY holding a user session — see PHASE 4.
-- That asymmetry is the whole security story: profiles' UPDATE policy is
-- `auth.uid() = id`, so without the column-level revoke below, every user could
-- grant themselves access to the product by updating their own row.
--
-- `is_whitelisted()` is NOT removed. It reads the JWT claim directly and stays the
-- correct check for anything running server-side, where there may be no profile
-- row to trust yet.

-- --------------------------------------------
-- PHASE 1: COLUMN
-- --------------------------------------------
-- DEFAULT false, not NULL: an unknown answer to "may this account use the
-- product" has to read as no. Every path that writes the column overwrites the
-- default immediately.
ALTER TABLE public.profiles
    ADD COLUMN whitelist BOOLEAN NOT NULL DEFAULT false;

UPDATE public.profiles p SET whitelist = public.whitelist_matches(p.email);

COMMENT ON COLUMN public.profiles.whitelist IS
    'Materialized from public.whitelist via whitelist_matches(email). Maintained '
    'by handle_new_user() and the two triggers in CG-035. Read-only to clients — '
    'UPDATE is revoked at column level from authenticated.';

-- Every recompute path filters on `email`, and the resync below touches the whole
-- table; the index is what keeps a roster edit from being a seq scan per row.
CREATE INDEX idx_profiles_whitelist ON public.profiles (whitelist);

-- --------------------------------------------
-- PHASE 2: SET IT AT SIGNUP
-- --------------------------------------------
-- CREATE OR REPLACE, and the trigger on auth.users is NOT recreated — the
-- precedent set by CG-016, CG-028 and CG-031, all of which redefined this
-- function and left `on_auth_user_created` alone. The body below is CG-028's
-- verbatim with one column added; its comments are preserved because they explain
-- decisions that are still in force.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, phone, email_verified, whitelist)
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
      and coalesce((new.raw_user_meta_data ->> 'email_verified')::boolean, false),
    -- CG-035. Evaluated here rather than left to the resync trigger because that
    -- one only fires on roster edits: an account signing up against a rule that
    -- already exists would otherwise sit at false until someone happened to touch
    -- public.whitelist, which may be never.
    public.whitelist_matches(new.email)
  );
  return new;
end;
$$;

-- CG-010 lockdown, re-applied. CREATE OR REPLACE resets the function's ACL to the
-- default (EXECUTE to PUBLIC), so omitting this would quietly re-open a SECURITY
-- DEFINER function that writes to `profiles` to anon and authenticated.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
    'Seeds public.profiles from a new auth.users row. Reads both our own signup '
    'metadata (full_name/avatar_url) and Google OIDC claims (name/picture), '
    'pre-marks email_verified for identities a provider has already verified '
    '(CG-028), and evaluates the whitelist gate (CG-035). Trigger-only: EXECUTE '
    'is revoked from PUBLIC/anon/authenticated.';

-- --------------------------------------------
-- PHASE 3: KEEP IT TRUE
-- --------------------------------------------
-- Input 1 — the roster changed. Statement-level, not row-level: adding a domain
-- rule is one logical act whose effect is global, and a bulk roster edit should
-- recompute the table once rather than once per affected row.
CREATE OR REPLACE FUNCTION public.resync_profiles_whitelist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.profiles p
       SET whitelist = public.whitelist_matches(p.email)
     -- The guard is not an optimization. `profiles` is in the realtime publication
     -- and carries the CG-016 realtime_table_events AFTER trigger, so an
     -- unfiltered UPDATE would emit one event per user in the system every time an
     -- operator adds a single address. Only rows whose answer actually changed are
     -- written.
     WHERE p.whitelist IS DISTINCT FROM public.whitelist_matches(p.email);
    RETURN NULL;
END;
$$;

CREATE TRIGGER on_whitelist_changed_resync_profiles
    AFTER INSERT OR UPDATE OR DELETE ON public.whitelist
    FOR EACH STATEMENT EXECUTE FUNCTION public.resync_profiles_whitelist();

-- Input 2 — the profile's address changed. Row-level and scoped to the one row,
-- because the alternative is a user who moves from an approved domain to an
-- unapproved one and keeps their access until the next unrelated roster edit.
CREATE OR REPLACE FUNCTION public.set_profile_whitelist_from_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.whitelist := public.whitelist_matches(NEW.email);
    RETURN NEW;
END;
$$;

-- BEFORE, so it writes NEW in place rather than issuing a second UPDATE that
-- would re-fire every AFTER trigger on the table. `OF email` keeps it off the
-- hot path of ordinary profile edits (name, avatar, phone).
CREATE TRIGGER on_profiles_email_changed_set_whitelist
    BEFORE UPDATE OF email ON public.profiles
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.set_profile_whitelist_from_email();

REVOKE EXECUTE ON FUNCTION public.resync_profiles_whitelist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_profile_whitelist_from_email() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------
-- PHASE 4: NOBODY WITH A SESSION MAY WRITE IT
-- --------------------------------------------
-- The security-critical step. `profiles`' UPDATE policy is `auth.uid() = id`,
-- which is correct for every other column on the table and catastrophic for this
-- one: it says a user may edit their own row, and this column decides whether that
-- user may use the product at all.
--
-- A column privilege rather than a BEFORE UPDATE trigger that resets the value.
-- The trigger would work, but it makes an unauthorized write succeed silently; the
-- privilege makes it fail loudly, which is what a caller attempting it deserves
-- and what a log will actually show. Column privileges are also checked before
-- RLS, so this holds regardless of any policy added later.
--
-- THE ORDER BELOW IS THE WHOLE TRICK, and getting it wrong is silent. Supabase
-- ships `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`, so
-- these roles hold UPDATE at the TABLE level. A bare
-- `REVOKE UPDATE (whitelist) ...` against that is a no-op: Postgres has no
-- column-level entry to remove, and the table-level grant still confers the
-- privilege on every column including the new one. The table grant has to come
-- off first, and the columns that should stay writable then get named back
-- individually. (This migration's VERIFY block caught exactly that mistake.)
REVOKE UPDATE ON public.profiles FROM anon, authenticated;

-- Every column as of CG-035 except `whitelist`. Deliberately enumerated rather
-- than derived: a column added later is NOT writable until someone adds it here,
-- which is the right default for a table whose rows are identity.
GRANT UPDATE (
    id, email, full_name, avatar_url, created_at, updated_at, email_verified, phone
) ON public.profiles TO authenticated;

-- `anon` is not re-granted anything. It never had a working UPDATE — profiles'
-- policy is `auth.uid() = id`, which is NULL and therefore false for an anonymous
-- caller — so this removes a privilege that RLS was already refusing to honour,
-- and nothing that worked before stops working.
--
-- The triggers above are unaffected: they are SECURITY DEFINER and run as the
-- owner. service_role keeps its table-level grant so an operator or an edge
-- function can still correct a row by hand.
--
-- NOTE FOR WHOEVER ADDS THE NEXT COLUMN: `profiles` is now on column-wise UPDATE
-- grants. Use `GRANT UPDATE (new_column) ON public.profiles TO authenticated`.
-- A blanket `GRANT UPDATE ON public.profiles` would silently re-open `whitelist`.

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
-- Structural assertions only. The behavioural loop — roster edit flips a profile,
-- removal flips it back — is deliberately NOT asserted here: the only way to test
-- it in-migration is to mutate a real profile row and then unwind, and a DO block
-- cannot unwind. Raising to roll back would abort the migration itself. That test
-- lives in the manual verification steps instead.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'whitelist'
    ) THEN
        RAISE EXCEPTION 'CG-035 incomplete — profiles.whitelist missing';
    END IF;

    IF has_column_privilege('authenticated', 'public.profiles', 'whitelist', 'UPDATE') THEN
        RAISE EXCEPTION 'CG-035 incomplete — authenticated can still UPDATE profiles.whitelist';
    END IF;

    IF NOT has_column_privilege('authenticated', 'public.profiles', 'whitelist', 'SELECT') THEN
        RAISE EXCEPTION 'CG-035 incomplete — authenticated cannot SELECT profiles.whitelist';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'on_whitelist_changed_resync_profiles' AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'CG-035 incomplete — resync trigger missing on public.whitelist';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'on_profiles_email_changed_set_whitelist' AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'CG-035 incomplete — email-change trigger missing on public.profiles';
    END IF;

    -- The backfill above and handle_new_user() must agree. Any row disagreeing
    -- with the matcher right now means one of the two write paths is wrong.
    IF EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.whitelist IS DISTINCT FROM public.whitelist_matches(p.email)
    ) THEN
        RAISE EXCEPTION 'CG-035 incomplete — profiles.whitelist disagrees with whitelist_matches()';
    END IF;
END $$;
