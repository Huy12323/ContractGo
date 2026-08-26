-- ===========================================================================
-- CG-032 — PER-RECIPIENT AUTHENTICATION, BY INHERITANCE
-- ===========================================================================
--
-- CG-031 made "how do recipients prove who they are" a decision the sender
-- makes — but it makes it ONCE, for the whole envelope. Real documents are not
-- uniform: a buyer signing a one-off purchase should be able to sign straight
-- from the email, while the witness or the countersigning officer on the same
-- document should have to hold a proved account. One setting for four
-- recipients forces the sender to pick the weakest requirement any party can
-- meet, and apply it to everyone.
--
-- This adds a NULLABLE per-recipient override. NULL — which is every row that
-- exists — means INHERIT `signature_requests.signer_auth`. So:
--
--   * every envelope in flight resolves to exactly the value CG-031 pinned on
--     it, because every signer row is NULL;
--   * every saved draft does too;
--   * the resolution is one COALESCE at one place in TypeScript
--     (`resolveEffectiveSignerAuth` in `_shared/signerAuth.ts`).
--
-- THE EXISTING ENUM, NOT A TWIN. `{table}_{column}_enum` is the rule for
-- CREATING a type without collisions; it is not an ownership claim, and there
-- is no second vocabulary here to name. A parallel
-- `signature_request_signers_auth_method_enum` would be actively harmful:
-- PostgreSQL will not compare two enum types without a cast, so
-- `COALESCE(s.auth_method, r.signer_auth)` — the one expression this column
-- exists for — becomes a double cast through TEXT, the construct that accepts
-- a value the target type does not have and fails at runtime rather than at
-- DDL time. It would also drift the day `sms_otp` lands, which is not
-- hypothetical: `_shared/signing.ts` already names `sms_vendor` and CG-016
-- already collects `signer_phone` for it. One type also means one
-- `Utils_Options_EnumsToOptions` array feeding both controls.
--
-- THE COLUMN IS `auth_method`, DELIBERATELY NOT `signer_auth`. In edge-function
-- code the two reads sit side by side as `ctx.signer.auth_method` and
-- `ctx.request.signer_auth`. Two columns one word apart, with different
-- nullability and different precedence, is the exact shape of a bug that
-- silently DOWNGRADES an auth requirement and is invisible in review. It also
-- keeps `grep signer_auth` returning only envelope-level reads.
--
-- NO INDEX, DELIBERATELY. The only reader is the single-row fetch by `id` that
-- `resolveSignerToken` already performs. An index here would cost a write per
-- signer insert and pay nothing back.
--
-- NO SQL RESOLVER FUNCTION, DELIBERATELY. Under the CG-010 rule every new
-- `public` function needs a REVOKE/GRANT pair naming `anon` and `authenticated`
-- plus a `has_function_privilege` assertion — roughly fifteen lines of security
-- scaffolding wrapped around a COALESCE, and fifteen lines of new grant surface
-- for zero benefit. Both readers are TypeScript.
--
-- NOTHING IS DROPPED OR RECREATED BY THIS FILE, so no ACL is reset and there is
-- nothing new for a grant tripwire to point at. Contrast CG-031 PHASE 5, which
-- had to DROP/CREATE `signer_token_redeem` and therefore had to restate its
-- grants. The VERIFY block below asserts the additive-safety property instead:
-- every existing row still inherits.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PHASE 1: THE OVERRIDE
-- ---------------------------------------------------------------------------

ALTER TABLE public.signature_request_signers
    ADD COLUMN auth_method public.signature_requests_signer_auth_enum;

COMMENT ON COLUMN public.signature_request_signers.auth_method IS
    'Per-recipient override of signature_requests.signer_auth (CG-032). NULL '
    'means INHERIT the envelope-level choice, which is what every row created '
    'before this migration does and what the composer stores unless the sender '
    'explicitly excepts this recipient. Same enum type as the envelope column '
    'on purpose: COALESCE(auth_method, signer_auth) must not need a cast. '
    'Resolved in TypeScript by resolveEffectiveSignerAuth(); no SQL reader.';

-- ---------------------------------------------------------------------------
-- PHASE 2: A CC NEVER AUTHENTICATES
-- ---------------------------------------------------------------------------
-- `assertCanAct` refuses a `view`-purpose token before `assertSignerIdentity`
-- is ever reached, so an auth requirement stored on a CC row is a control the
-- composer would render and the server could never honour. Same shape and same
-- reasoning as CG-011's `recipient_shape_check`, which is why the constraint
-- is named for the column rather than folded into that one — a failure should
-- say which rule was broken.
--
-- Validates trivially: every existing row has auth_method IS NULL.

ALTER TABLE public.signature_request_signers
    ADD CONSTRAINT signature_request_signers_auth_method_check
    CHECK (recipient_type = 'signer' OR auth_method IS NULL);

-- ---------------------------------------------------------------------------
-- PHASE 3: VERIFY
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_overrides INT;
BEGIN
    -- The whole additive-safety claim of this migration, as an assertion: no
    -- recipient's rules changed underneath them. If this ever fails, something
    -- backfilled the column and every in-flight ceremony's requirement moved.
    SELECT count(*) INTO v_overrides
      FROM public.signature_request_signers
     WHERE auth_method IS NOT NULL;

    IF v_overrides > 0 THEN
        RAISE EXCEPTION
            'CG-032: % signer row(s) already carry an override; expected 0 — every '
            'pre-existing recipient must still inherit the envelope-level choice.',
            v_overrides;
    END IF;

    RAISE NOTICE 'CG-032: every existing recipient still inherits signature_requests.signer_auth.';
END $$;

DO $$
BEGIN
    -- One type, not two. If a twin enum ever appears, the COALESCE this column
    -- exists for has silently become a double cast through TEXT.
    IF (
        SELECT atttypid FROM pg_attribute
         WHERE attrelid = 'public.signature_request_signers'::regclass
           AND attname  = 'auth_method'
    ) IS DISTINCT FROM 'public.signature_requests_signer_auth_enum'::regtype THEN
        RAISE EXCEPTION
            'CG-032: signature_request_signers.auth_method must use '
            'signature_requests_signer_auth_enum — see this file''s header.';
    END IF;

    IF (
        SELECT attnotnull FROM pg_attribute
         WHERE attrelid = 'public.signature_request_signers'::regclass
           AND attname  = 'auth_method'
    ) THEN
        RAISE EXCEPTION
            'CG-032: auth_method must stay NULLABLE — NULL is how a recipient inherits.';
    END IF;

    RAISE NOTICE 'CG-032: override column verified — shared enum, nullable, CC-excluded.';
END $$;

DO $$
BEGIN
    -- The CHECK is load-bearing for the composer, which clamps CC rows to NULL
    -- so a client bug is a null rather than a constraint-name 500. Assert it
    -- actually refuses.
    BEGIN
        PERFORM 1
          FROM public.signature_request_signers
         WHERE recipient_type = 'cc'
         LIMIT 1;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.signature_request_signers'::regclass
               AND conname  = 'signature_request_signers_auth_method_check'
        ) THEN
            RAISE EXCEPTION 'CG-032: signature_request_signers_auth_method_check is missing.';
        END IF;
    END;

    RAISE NOTICE 'CG-032: CC recipients cannot carry an auth requirement.';
END $$;
