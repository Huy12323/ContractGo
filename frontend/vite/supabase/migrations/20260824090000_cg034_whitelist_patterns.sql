-- ============================================
-- CG-034: WHITELIST PATTERNS
-- ============================================
-- CG-027 keyed the whitelist on a single exact address. That is correct and it
-- does not scale: onboarding one company means adding every one of its people by
-- hand, and the operator finds out they missed someone when that someone files a
-- support ticket from /pending-access.
--
-- This migration replaces the single `email` column with a (pattern, value) pair.
-- `pattern` names the KIND of match; `value` holds the string it matches against.
-- The alternative — one column whose meaning is inferred from whether it happens
-- to contain a `*` — was rejected: the kind would be implicit, unvalidatable, and
-- impossible to extend without re-parsing every existing row.
--
--   pattern    value                 matches
--   ---------  --------------------  ----------------------------------------
--   exact      abc@gmail.com         that address, and only that address
--   domain     gotosoft.net          anything whose domain part is exactly this
--   wildcard   *@gotosoft.net        glob over the whole address, `*` = any run
--
-- `domain` and `wildcard` overlap for the common case, deliberately. `domain` is
-- the one an operator should reach for — it cannot be written wrong in a way that
-- matches more than intended, because it compares the domain part rather than a
-- suffix. `wildcard` exists for the cases `domain` cannot express, such as
-- `qa+*@gotosoft.net`.
--
-- Everything CG-027 decided that is not about matching still holds and is not
-- restated here: no organization_id (this is a platform-level gate), RLS on with
-- zero policies, not in the realtime publication, and the external signing
-- surface at /sign/$accessToken deliberately outside the gate.
--
-- Management is still by hand, in SQL or Studio:
--   INSERT INTO public.whitelist (pattern, value, note)
--        VALUES ('domain', 'gotosoft.net', 'partner org, approved by X');
--   UPDATE public.whitelist SET enabled = false WHERE value = 'gotosoft.net';

-- --------------------------------------------
-- PHASE 1: MATCH KIND
-- --------------------------------------------
CREATE TYPE public.whitelist_pattern_enum AS ENUM ('exact', 'domain', 'wildcard');

-- --------------------------------------------
-- PHASE 2: RESHAPE THE TABLE
-- --------------------------------------------
-- `pattern` takes a DEFAULT for the length of this migration only. Every existing
-- row is an exact address by construction — CG-027 had no other kind — so the
-- default backfills them correctly, and it is dropped at the end of the phase so
-- future inserts must state their kind rather than inherit a guess.
ALTER TABLE public.whitelist
    ADD COLUMN pattern public.whitelist_pattern_enum NOT NULL DEFAULT 'exact',
    ADD COLUMN value   TEXT,
    -- Turning a row off without losing the note that says who approved it and
    -- why. Revoking access by DELETE destroys that record; this keeps it.
    ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE public.whitelist SET value = email;

ALTER TABLE public.whitelist
    ALTER COLUMN value SET NOT NULL,
    -- Carried over from CG-027 verbatim, for the same reason: `whitelist_matches`
    -- below lowercases its argument and compares plainly, so a mixed-case row
    -- would silently never match. A whitelist that fails closed on a typo is a
    -- support ticket nobody can diagnose. The CHECK makes it an insert error.
    ADD CONSTRAINT whitelist_value_lower CHECK (value = lower(value)),
    -- Drops the UNIQUE index with it; replaced below by (pattern, value).
    DROP COLUMN email,
    ALTER COLUMN pattern DROP DEFAULT;

-- The same string means different things under different kinds, so uniqueness is
-- over the pair. ('domain','gotosoft.net') and ('wildcard','*@gotosoft.net') are
-- different rows saying nearly the same thing, and that is allowed.
CREATE UNIQUE INDEX whitelist_pattern_value_key ON public.whitelist (pattern, value);

-- Shape validation, in the same spirit as the lower() check: a row whose value
-- does not fit its kind is not a subtly-wrong match, it is a row that can never
-- match anything. Better an insert error than a silent no-op.
ALTER TABLE public.whitelist ADD CONSTRAINT whitelist_value_shape CHECK (
    CASE pattern
        WHEN 'exact'    THEN value LIKE '%@%' AND value NOT LIKE '%*%'
        -- A bare domain. No '@' — 'gotosoft.net', not '@gotosoft.net' — because
        -- the matcher compares it to split_part(email,'@',2), which yields no '@'.
        WHEN 'domain'   THEN value NOT LIKE '%@%' AND value NOT LIKE '%*%'
        -- Must contain both, or it is one of the other two kinds misfiled: no '*'
        -- means it is exact, no '@' means it would match local parts across every
        -- domain on the internet.
        WHEN 'wildcard' THEN value LIKE '%*%' AND value LIKE '%@%'
    END
);

COMMENT ON COLUMN public.whitelist.pattern IS
    'How `value` is matched against an address: exact | domain | wildcard (CG-034).';
COMMENT ON COLUMN public.whitelist.value IS
    'The match string, always lowercase. Meaning depends on `pattern` (CG-034).';
COMMENT ON COLUMN public.whitelist.enabled IS
    'Soft off-switch. A disabled row never matches but keeps its note (CG-034).';

-- --------------------------------------------
-- PHASE 3: THE MATCHER
-- --------------------------------------------
-- One definition of "matches", used by both the RPC below and CG-035's
-- materializing triggers. Two copies would drift, and the drift would show up as
-- a gate that disagrees with the column behind it — the worst possible failure
-- mode for an access check, because each side looks correct in isolation.
--
-- STABLE, not IMMUTABLE: it reads a table.
CREATE OR REPLACE FUNCTION public.whitelist_matches(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.whitelist w
         WHERE w.enabled
           AND p_email IS NOT NULL
           AND CASE w.pattern
                   WHEN 'exact'  THEN lower(p_email) = w.value
                   -- split_part rather than a suffix LIKE. 'gotosoft.net' as a
                   -- suffix would also match 'evil-gotosoft.net' and
                   -- 'x@a.gotosoft.net.attacker.com'; comparing the domain part
                   -- cannot.
                   WHEN 'domain' THEN split_part(lower(p_email), '@', 2) = w.value
                   -- Glob translated to LIKE. Order is load-bearing: escape the
                   -- characters LIKE already treats as special (\, %, _) FIRST,
                   -- then map the intended '*' to '%'. Doing the '*' swap first
                   -- would introduce a '%' that the escape pass then neutralizes,
                   -- turning every wildcard row into an exact match on a literal
                   -- percent sign. Doing the '_' escape after would leave a stored
                   -- '_' acting as "any single character" — so '*@a_b.net' would
                   -- approve 'x@axb.net', a domain the operator never listed.
                   WHEN 'wildcard' THEN lower(p_email) LIKE
                       replace(
                           replace(
                               replace(
                                   replace(w.value, '\', '\\'),
                               '%', '\%'),
                           '_', '\_'),
                       '*', '%')
               END
    );
$$;

COMMENT ON FUNCTION public.whitelist_matches(TEXT) IS
    'True when the address matches any enabled public.whitelist row. The single '
    'definition of whitelist membership — is_whitelisted() and the CG-035 '
    'profiles.whitelist triggers both call it (CG-034).';

-- --------------------------------------------
-- PHASE 4: THE RPC, REWIRED
-- --------------------------------------------
-- Same signature, same posture, same reason for reading the JWT claim rather than
-- profiles: no extra join, and it cannot be spoofed by a profile update. Only the
-- body changes.
CREATE OR REPLACE FUNCTION public.is_whitelisted()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT public.whitelist_matches((SELECT auth.jwt()) ->> 'email');
$$;

-- --------------------------------------------
-- GRANTS
-- --------------------------------------------
-- CG-010 discipline: every SECURITY DEFINER surface states who can reach it, in
-- the file that creates it. CREATE OR REPLACE resets the ACL to EXECUTE-to-PUBLIC,
-- so this is not optional for is_whitelisted() even though CG-027 already said it.
REVOKE EXECUTE ON FUNCTION public.whitelist_matches(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.whitelist_matches(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_whitelisted() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_whitelisted() TO authenticated, service_role;

-- Note the asymmetry: `authenticated` gets is_whitelisted() (which answers only
-- "am I on it?") but NOT whitelist_matches() (which answers "is ANY address on
-- it?"). The second is an oracle over the roster — a client holding it could
-- enumerate approved domains one guess at a time, which is exactly what RLS-with-
-- no-policies on the table exists to prevent.

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'whitelist' AND column_name = 'email'
    ) THEN
        RAISE EXCEPTION 'CG-034 incomplete — public.whitelist.email still present';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'whitelist' AND column_name = 'value'
    ) THEN
        RAISE EXCEPTION 'CG-034 incomplete — public.whitelist.value missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whitelist'
    ) THEN
        RAISE EXCEPTION 'CG-034 incomplete — public.whitelist must still have no RLS policies';
    END IF;

    IF has_function_privilege('authenticated', 'public.whitelist_matches(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-034 incomplete — authenticated holds EXECUTE on whitelist_matches()';
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.is_whitelisted()', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-034 incomplete — authenticated lost EXECUTE on is_whitelisted()';
    END IF;

    -- The escape-order bug this function is most likely to grow back, asserted
    -- rather than described. A literal underscore in a stored value must not act
    -- as LIKE's single-character wildcard.
    INSERT INTO public.whitelist (pattern, value, note)
         VALUES ('wildcard', '*@cg034-verify_probe.test', 'CG-034 self-check, deleted below');

    IF public.whitelist_matches('someone@cg034-verifyxprobe.test') THEN
        RAISE EXCEPTION 'CG-034 incomplete — wildcard escaping treats `_` as a wildcard';
    END IF;

    IF NOT public.whitelist_matches('SomeOne@cg034-verify_probe.test') THEN
        RAISE EXCEPTION 'CG-034 incomplete — wildcard match failed on a literal value';
    END IF;

    DELETE FROM public.whitelist WHERE value = '*@cg034-verify_probe.test';
END $$;
