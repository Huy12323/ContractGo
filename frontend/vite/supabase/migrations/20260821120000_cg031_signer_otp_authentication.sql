-- ===========================================================================
-- CG-031 — SIGN FROM THE EMAIL: SENDER-CHOSEN RECIPIENT AUTHENTICATION
-- ===========================================================================
--
-- Until now every signature required the recipient to hold a ContractGo account
-- on the exact address the document names. `signing_session_open` was already
-- public — a recipient can READ what they were sent with no account at all —
-- but `assertSignerAccount` gated the commit, so an external counterparty had to
-- sign up for a platform they may use once. That is one hard-coded policy
-- applied to every envelope regardless of what it is worth, and it is the
-- biggest drop-off between "sent" and "signed".
--
-- This migration makes the requirement a DECISION THE SENDER MAKES, per
-- document, at send time:
--
--   signer_auth = 'account'     the existing behaviour: a session on the
--                               signer's own proved address.
--   signer_auth = 'email_otp'   the emailed link opens the document, and a
--                               one-time passcode sent to the recipient's
--                               address authorises the commit. No account.
--
-- AN ENUM AND NOT A BOOLEAN. `_shared/signing.ts` already declares
-- `OtpDriverName = 'mock' | 'email' | 'sms_vendor'` and an `IdentityDriver` for
-- eKYC, and CG-016 added `signer_phone` explicitly for the SMS passcode when
-- that driver lands. A boolean would need a schema migration the day either
-- arrives; it also could not feed `Utils_Options_EnumsToOptions`, which
-- `bible-supabase-options` requires for the composer's radio group.
--
-- WHY A PASSCODE AND NOT THE LINK ALONE. Possession of the link proves someone
-- reached the mailbox at some point; links get forwarded, archived and scanned.
-- A passcode issued on demand and redeemed within minutes proves someone
-- controls that mailbox NOW. It is weaker evidence than an account whose address
-- was proved and which persists, which is exactly why the choice is the
-- sender's and why the audit chain records which of the two happened rather
-- than collapsing them into "authenticated".
--
-- THE EVIDENCE SLOT ALREADY EXISTS. `_shared/auditEvidence.ts` has declared
-- `AuditAuthMethod = … | 'otp'` and `AuditAuth.otp: { channel, verified_at }`
-- since CG-016, both commented "explicitly null until the OTP driver is wired
-- (v1.2.0)", and `App_EnvelopeTimeline` already renders "OTP not used" from it.
-- This is that driver. No audit shape changes and no timeline changes; a field
-- that was always null starts being populated.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not touch
-- `profiles.email_verified`. See PHASE 7.
--
-- NO `anon` REACHES ANY OF THIS. CG-009/010/015 assert that no RLS policy
-- targets `anon` and that no SECURITY DEFINER function is executable by
-- anon/authenticated outside a stated allowlist. Both are re-asserted at the
-- bottom of this file: `signer_otp_challenges` gets RLS with zero policies,
-- exactly like `signer_access_tokens` (CG-005), and the new routines are
-- service_role-only. Neither is added to the CG-010 allowlist, because neither
-- is meant to be reachable without the service key.
--
-- ONE FILE IS SAFE HERE. PostgreSQL forbids an enum value added in a
-- transaction from being REFERENCED in that same transaction (CG-016:49). The
-- values added in PHASE 6 are written only by the edge functions, and nothing
-- below — including the behavioural probe — inserts an audit row, so the two
-- never meet. CG-011 added six values inline for the same reason.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PHASE 1: THE SENDER'S CHOICE, PINNED ONTO THE ENVELOPE
-- ---------------------------------------------------------------------------
-- NOT NULL DEFAULT 'account' is what makes this migration safe on documents that
-- are already in flight, and on every saved draft: everything that exists today
-- keeps demanding an account, and no recipient's rules change underneath them
-- mid-ceremony.
--
-- Like `expires_at` and `reminder_days` (CG-013), this is an absolute fact about
-- THIS SEND, resolved once by `envelopes_send` and never re-read from the
-- template. A template edited next week must not retroactively change how a
-- document sent today may be signed.

CREATE TYPE public.signature_requests_signer_auth_enum AS ENUM ('account', 'email_otp');

ALTER TABLE public.signature_requests
    ADD COLUMN signer_auth public.signature_requests_signer_auth_enum
        NOT NULL DEFAULT 'account';

COMMENT ON COLUMN public.signature_requests.signer_auth IS
    'How recipients prove who they are before signing (CG-031). account = a '
    'session on their own proved address; email_otp = a one-time passcode to '
    'the address the document names, no account required. Pinned at send time; '
    'never re-read from the template.';

-- ---------------------------------------------------------------------------
-- PHASE 2: PASSCODE STATE
-- ---------------------------------------------------------------------------
-- Split deliberately across two places:
--
--   signer_access_tokens.otp_verified_at  the DURABLE verdict, on the credential
--       the passcode authorises. It survives a page reload, it is already what
--       `resolveSignerToken` fetches on every call, and the audit chain already
--       carries `token_id` — so "which credential was this signature made with,
--       and had it been passcode-verified" is one row, not a join.
--
--   signer_otp_challenges                 the ATTEMPT RECORD. Codes issued,
--       codes got wrong, codes that expired unused. Overwriting a single column
--       would destroy exactly the evidence that says whether someone was
--       guessing.
--
-- Binding to the TOKEN rather than to the signer is what makes `envelopes_resend`
-- correct for free: a resend mints a new token and revokes the old one, so the
-- new link starts unverified rather than inheriting a verdict reached on a
-- credential that has since been withdrawn. The same holds for the
-- request-changes loop, which also re-issues.
--
-- `otp_verified_at` IS A TIMESTAMP AND NOT A FLAG because the caller judges it
-- against a freshness window (`assertSignerIdentity`, 15 minutes). A token lives
-- fourteen days; a boolean would mean one passcode makes a forwarded link hot
-- for a fortnight, which is precisely the "whoever held the URL" failure the
-- account requirement was written to condemn.

ALTER TABLE public.signer_access_tokens
    ADD COLUMN otp_verified_at TIMESTAMPTZ,
    -- Recorded, never enforced. Mobile networks rotate addresses mid-ceremony,
    -- so refusing on a mismatch would reject honest signers; but a passcode
    -- answered from one country and a signature made from another is evidence,
    -- and it costs one column to be able to say so.
    ADD COLUMN otp_verified_ip INET;

COMMENT ON COLUMN public.signer_access_tokens.otp_verified_at IS
    'When a one-time passcode was last redeemed against this token (CG-031). '
    'NULL means no passcode has been passed on this credential. Freshness is '
    'judged by the caller against a window; this column never expires itself.';

CREATE TABLE public.signer_otp_challenges (
    id TEXT PRIMARY KEY DEFAULT generate_id('otc'),
    token_id TEXT NOT NULL REFERENCES public.signer_access_tokens(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES public.signature_request_signers(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- BCRYPT, NOT SHA-256. Six digits is twenty bits: an unsalted sha256 of a
    -- million-value space is a rainbow table someone can build in a second, so a
    -- database dump would hand over every live passcode. `crypt`/`gen_salt` come
    -- from pgcrypto, which this project already depends on for the audit hash
    -- chain and for `signer_token_issue`. The work factor is a second benefit:
    -- it puts a floor under the cost of each guess.
    code_hash TEXT NOT NULL,
    -- 'email' today. SMS is the next driver (`OtpDriverName`) and `signer_phone`
    -- is already collected as evidence (CG-016), so this is a column rather than
    -- an assumption baked into the table name.
    channel TEXT NOT NULL DEFAULT 'email',

    expires_at TIMESTAMPTZ NOT NULL,
    -- SIX DIGITS IS ONLY SAFE BECAUSE OF THIS. A million-value code with
    -- unlimited guesses is not a credential. The attempt cap, not the length, is
    -- what makes it one, which is why the counter lives next to the hash and is
    -- incremented by the same statement that tests the match.
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    consumed_at TIMESTAMPTZ,
    -- Who asked for it, for the same evidentiary reason `last_used_ip` exists on
    -- the token: a burst of challenges from an address that is not the signer's
    -- is the shape of an attack on a link that leaked.
    requested_ip INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signer_otp_challenges_max_attempts_check CHECK (max_attempts >= 1),
    CONSTRAINT signer_otp_challenges_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX idx_signer_otp_challenges_token_id
    ON public.signer_otp_challenges(token_id);
CREATE INDEX idx_signer_otp_challenges_request_id
    ON public.signer_otp_challenges(request_id);
CREATE INDEX idx_signer_otp_challenges_organization_id
    ON public.signer_otp_challenges(organization_id);
-- The throttle's read: "challenges for this token, newest first". Without it
-- every passcode request sequentially scans a table that only ever grows.
CREATE INDEX idx_signer_otp_challenges_token_created
    ON public.signer_otp_challenges(token_id, created_at DESC);

COMMENT ON TABLE public.signer_otp_challenges IS
    'One-time passcode challenges for external signers (CG-031). RLS is enabled '
    'with NO policies at all — not even for admins — so the table is unreachable '
    'from any client key and readable only by the SECURITY DEFINER routines '
    'below. A code hash is a credential; nothing in the app needs to read one.';

-- CG-005's 1-hop convention: organization_id is derived from the parent request
-- rather than trusted from the caller. `set_org_id_from_signature_request`
-- already exists and already reads `NEW.request_id`, so this table reuses it
-- rather than growing a near-identical twin.
CREATE TRIGGER trigger_set_org_id_signer_otp_challenges
    BEFORE INSERT ON public.signer_otp_challenges
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

ALTER TABLE public.signer_otp_challenges ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.

-- ---------------------------------------------------------------------------
-- PHASE 3: ISSUE
-- ---------------------------------------------------------------------------
-- MINTS THE CODE HERE, exactly as `signer_token_issue` mints a token: from
-- `gen_random_bytes`, returned to its caller once, never persisted in the clear.
-- The edge function hands the plaintext to `getOtpDriver().send()` and drops it
-- — which is the contract `_shared/signing.ts` already wrote down for that seam
-- ("Sends a code the CALLER generated. The driver never mints or stores one:
-- the hash and the attempt counter belong to the database.").
--
-- REJECTION SAMPLING, NOT MODULO. 2^32 is not a multiple of 10^6, so a bare
-- `% 1000000` makes the low 967296 codes measurably likelier than the rest.
-- 4294000000 IS a multiple, so discarding above it and then taking the modulus
-- is uniform. The bias would be small; "small enough not to matter" is not a
-- sentence worth writing about a credential when the fix is three lines.
--
-- THE THROTTLE IS IN HERE AND NOT IN TYPESCRIPT, for the same reason
-- `signer_token_redeem` is a single statement: a read-then-write check in the
-- edge function is two round trips with a gap in the middle, and two concurrent
-- POSTs both slip through it.
--
-- WHY A PER-TOKEN THROTTLE IS ENOUGH, in a project with no per-IP rate limiting
-- anywhere: every limit here is keyed to a credential, and a caller without a
-- valid one cannot reach this function at all — `resolveSignerToken` refuses
-- first. An attacker's total reach is bounded by the caps on the single token
-- they hold, not by how many sockets they can open.
--
-- Refusing is a RETURN, not a RAISE. "You asked too soon" is an ordinary answer
-- the signer surface renders as a countdown; an exception would make the caller
-- unable to tell it apart from a database fault.

CREATE OR REPLACE FUNCTION public.signer_otp_issue(
    p_token_id TEXT,
    p_ttl_minutes INTEGER DEFAULT 10,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(status TEXT, code TEXT, challenge_id TEXT, expires_at TIMESTAMPTZ, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    -- One passcode a minute is generous for a human who mistyped and pressed
    -- resend, and useless as a way to flood someone's inbox.
    c_cooldown_seconds CONSTANT INTEGER := 60;
    -- Six an hour bounds the total guessing surface on one token: even if every
    -- challenge were burned to its attempt cap that is 30 guesses against a
    -- space of a million, per hour, per credential. Without this the attempt cap
    -- would be theatre — request a thousand challenges and the caps multiply.
    c_max_per_hour     CONSTANT INTEGER := 6;

    v_signer_id  TEXT;
    v_request_id TEXT;
    v_last_at    TIMESTAMPTZ;
    v_recent     INTEGER;
    v_expires    TIMESTAMPTZ := now() + make_interval(mins => p_ttl_minutes);
    v_code       TEXT;
    v_draw       BIGINT;
    v_bytes      BYTEA;
    v_id         TEXT;
BEGIN
    SELECT t.signer_id, t.request_id
      INTO v_signer_id, v_request_id
      FROM public.signer_access_tokens t
     WHERE t.id = p_token_id
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now();

    -- A dead credential gets no passcode. Reported as a status rather than an
    -- exception so the caller can fold it into the same opaque refusal it gives
    -- for every other bad-token case — this must not become an oracle for
    -- probing which emailed links are still live.
    IF v_signer_id IS NULL THEN
        RETURN QUERY SELECT 'invalid_token'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
        RETURN;
    END IF;

    -- Housekeeping before counting: dead challenges for this token are of no
    -- evidentiary value once the request they belong to is closed, and clearing
    -- them here is cheaper than a cron job. Bounded to this token, so it can
    -- never turn into a table-wide sweep on a signer's click.
    -- Every statement in this function aliases the table. `expires_at` is both a
    -- column here and one of this function's OUT parameters, and plpgsql resolves
    -- the bare name to the variable — so an unqualified WHERE clause is not a
    -- style question, it is a silently wrong query. Postgres catches this one at
    -- runtime; it would not catch a column whose name shadowed a variable of the
    -- same type.
    DELETE FROM public.signer_otp_challenges c
     WHERE c.token_id = p_token_id
       AND c.consumed_at IS NULL
       AND c.expires_at < now() - interval '24 hours';

    SELECT max(c.created_at), count(*) FILTER (WHERE c.created_at > now() - interval '1 hour')
      INTO v_last_at, v_recent
      FROM public.signer_otp_challenges c
     WHERE c.token_id = p_token_id;

    IF v_last_at IS NOT NULL AND v_last_at > now() - make_interval(secs => c_cooldown_seconds) THEN
        RETURN QUERY SELECT
            'cooldown'::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TIMESTAMPTZ,
            ceil(extract(epoch FROM (v_last_at + make_interval(secs => c_cooldown_seconds)) - now()))::INTEGER;
        RETURN;
    END IF;

    IF v_recent >= c_max_per_hour THEN
        RETURN QUERY SELECT 'rate_limited'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
        RETURN;
    END IF;

    -- Supersede rather than delete: an unconsumed challenge is still a record
    -- that a passcode was sent to that mailbox at that moment. Expiring it in
    -- place keeps exactly one live challenge per token, which is what makes
    -- `signer_otp_verify`'s single-row match unambiguous. Same discipline as
    -- `signer_token_issue`, which revokes a signer's prior live token.
    UPDATE public.signer_otp_challenges c
       SET expires_at = now()
     WHERE c.token_id = p_token_id
       AND c.consumed_at IS NULL
       AND c.expires_at > now();

    LOOP
        v_bytes := gen_random_bytes(4);
        v_draw := (get_byte(v_bytes, 0)::BIGINT << 24)
                | (get_byte(v_bytes, 1)::BIGINT << 16)
                | (get_byte(v_bytes, 2)::BIGINT << 8)
                |  get_byte(v_bytes, 3)::BIGINT;
        EXIT WHEN v_draw < 4294000000;
    END LOOP;

    v_code := lpad((v_draw % 1000000)::TEXT, 6, '0');

    INSERT INTO public.signer_otp_challenges
        (token_id, signer_id, request_id, code_hash, expires_at, requested_ip)
    VALUES
        (p_token_id, v_signer_id, v_request_id, crypt(v_code, gen_salt('bf', 8)), v_expires, p_ip::inet)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT 'sent'::TEXT, v_code, v_id, v_expires, NULL::INTEGER;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 4: VERIFY
-- ---------------------------------------------------------------------------
-- ONE STATEMENT DECIDES AND RECORDS. The attempt counter is incremented by the
-- same UPDATE that tests the hash, so a client firing guesses in parallel cannot
-- get more tries than the cap: each concurrent statement takes the row lock and
-- sees the previous increment. A SELECT-then-UPDATE here would hand an attacker
-- as many guesses as they have open sockets, which is the one attack a
-- six-digit code is actually vulnerable to.
--
-- THE STATUS IS GRANULAR AND THE HTTP RESPONSE IS NOT. This returns 'invalid',
-- 'expired' and 'locked' separately because the audit chain should record which
-- happened; `signing_otp_verify` collapses the first two before replying, the
-- same way `signer_token_redeem`'s caller refuses to say whether a token was
-- expired, revoked or never existed. 'locked' does reach the signer, because it
-- is the one case where the right answer is "ask for a new code" rather than
-- "try again".

CREATE OR REPLACE FUNCTION public.signer_otp_verify(
    p_token_id TEXT,
    p_code TEXT,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(status TEXT, attempts_remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id       TEXT;
    v_attempts INTEGER;
    v_max      INTEGER;
    v_matched  BOOLEAN;
BEGIN
    -- Charge the attempt and test the hash together. The comparison sits in the
    -- SET/RETURNING expressions rather than in the WHERE clause on purpose: a
    -- wrong guess must still cost an attempt, so the row has to be matched on
    -- identity first and judged on content second.
    UPDATE public.signer_otp_challenges c
       SET attempts = c.attempts + 1,
           consumed_at = CASE
               WHEN c.code_hash = crypt(p_code, c.code_hash) THEN now()
               ELSE c.consumed_at
           END,
           requested_ip = COALESCE(p_ip::inet, c.requested_ip)
     WHERE c.id = (
            SELECT c2.id
              FROM public.signer_otp_challenges c2
             WHERE c2.token_id = p_token_id
               AND c2.consumed_at IS NULL
               AND c2.expires_at > now()
               AND c2.attempts < c2.max_attempts
             ORDER BY c2.created_at DESC
             LIMIT 1
            FOR UPDATE
        )
    RETURNING c.id, c.attempts, c.max_attempts, (c.consumed_at IS NOT NULL)
         INTO v_id, v_attempts, v_max, v_matched;

    IF v_id IS NULL THEN
        -- No live, unexhausted challenge. Either none was issued, the last aged
        -- out, or its attempts are spent. Distinguishing "spent" is worth doing
        -- because the surface must tell the signer to request a new code rather
        -- than to try harder.
        IF EXISTS (
            SELECT 1 FROM public.signer_otp_challenges c3
             WHERE c3.token_id = p_token_id
               AND c3.consumed_at IS NULL
               AND c3.expires_at > now()
               AND c3.attempts >= c3.max_attempts
        ) THEN
            RETURN QUERY SELECT 'locked'::TEXT, 0;
        ELSE
            RETURN QUERY SELECT 'expired'::TEXT, 0;
        END IF;
        RETURN;
    END IF;

    IF NOT v_matched THEN
        RETURN QUERY SELECT 'invalid'::TEXT, GREATEST(v_max - v_attempts, 0);
        RETURN;
    END IF;

    -- The durable verdict, on the credential. Written only after a match and in
    -- the same transaction as the match, so a token can never be marked verified
    -- by a challenge that was not passed.
    UPDATE public.signer_access_tokens
       SET otp_verified_at = now(),
           otp_verified_ip = COALESCE(p_ip::inet, otp_verified_ip)
     WHERE id = p_token_id;

    RETURN QUERY SELECT 'verified'::TEXT, GREATEST(v_max - v_attempts, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 5: TEACH `signer_token_redeem` ABOUT THE VERDICT — AND ABOUT NOT COUNTING
-- ---------------------------------------------------------------------------
-- Two changes, and the second is the one that matters.
--
-- 1. RETURN `otp_verified_at`. `resolveSignerToken` already makes this round
--    trip on every call to the public signing surface, so returning the verdict
--    means `assertSignerIdentity` decides without a second query — and, more to
--    the point, reads the verdict and the token state that authorises it
--    atomically rather than as two observations that could disagree.
--
-- 2. `p_count_use`. Every call to `resolveSignerToken` increments `use_count`,
--    and the token refuses at `max_uses` (100). The passcode endpoints call
--    `resolveSignerToken` too, so without this a signer fumbling codes on a slow
--    phone burns their own link — and, far worse, anyone holding a LEAKED link
--    can call `signing_otp_send` a hundred times and permanently lock out the
--    real signer, with no recovery but a sender resend. Counting is what "the
--    document was opened" means; asking for a passcode is not that.
--
--    Note the knock-on this avoids: `resolveSignerToken` chains
--    `signer_token_redeemed` when `use_count = 1`, so if a passcode call could
--    ever be a token's first redemption, the "this link was opened" entry would
--    be attached to the wrong act. With `p_count_use = false` it cannot be.
--
-- DROP first: the return type changes, and CREATE OR REPLACE cannot widen a
-- RETURNS TABLE. The body is CG-015's, including the POST-increment `use_count`
-- that CG-015 added; the atomic-UPDATE discipline this function exists for is
-- not being touched.

DROP FUNCTION IF EXISTS public.signer_token_redeem(TEXT, TEXT);

CREATE FUNCTION public.signer_token_redeem(
    p_token_hash TEXT,
    p_ip TEXT DEFAULT NULL,
    p_count_use BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    token_id TEXT,
    signer_id TEXT,
    request_id TEXT,
    organization_id TEXT,
    purpose public.signer_access_tokens_purpose_enum,
    use_count INTEGER,
    otp_verified_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE public.signer_access_tokens t
       SET use_count    = t.use_count + CASE WHEN p_count_use THEN 1 ELSE 0 END,
           last_used_at = now(),
           last_used_ip = COALESCE(p_ip::inet, t.last_used_ip)
     WHERE t.token_hash = p_token_hash
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now()
       AND t.use_count < t.max_uses
    RETURNING t.id, t.signer_id, t.request_id, t.organization_id, t.purpose,
              t.use_count, t.otp_verified_at;
$$;

COMMENT ON FUNCTION public.signer_token_redeem(TEXT, TEXT, BOOLEAN) IS
    'Atomically validates and consumes one use of an access token. Returns the '
    'POST-increment use_count (CG-015) so the caller can chain '
    'signer_token_redeemed on a credential''s first use and only then, and '
    'otp_verified_at (CG-031) so assertSignerIdentity can judge a passcode '
    'verdict without a second query. p_count_use = false validates without '
    'spending a use — for the passcode endpoints, which must not be able to '
    'exhaust a signer''s link.';

-- ---------------------------------------------------------------------------
-- PHASE 6: AUDIT EVENT TYPES
-- ---------------------------------------------------------------------------
-- Three, not one. "A passcode was issued", "a passcode was answered" and "a
-- passcode was got wrong" are different facts, and only the third is the shape
-- of an attack. Collapsing them into a single `signer_otp` event would make the
-- trail unable to answer the question it exists for. Repeated failures on one
-- document are the only signal a sender would ever get that a link has leaked.
--
-- Same note as CG-011: `signature_audit_entry_hash`'s parameter stays TEXT, so
-- entries hashed before this change stay verifiable after it.

ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_otp_issued';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_otp_verified';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_otp_failed';

-- ---------------------------------------------------------------------------
-- PHASE 7: WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- The other half of "login only when necessary" is that a recipient facing an
-- `account` envelope with no account must still be able to get in without a
-- password. The obvious implementation is a trigger on
-- `auth.users.email_confirmed_at` that sets `profiles.email_verified`.
--
-- THAT TRIGGER WOULD BE A SECURITY REGRESSION, and it is written down here so
-- nobody adds it later believing it was merely forgotten.
--
-- `config.toml` sets `enable_confirmations = false`, which in GoTrue means
-- AUTOCONFIRM: `email_confirmed_at` is stamped at signup, before the account
-- holder has proved anything at all. That is exactly why this project owns
-- verification itself, in `profiles.email_verified`, written only by
-- `auth_verify-token` (CG-006). A trigger keyed on `email_confirmed_at` would
-- therefore flip `email_verified = true` for every password signup in the
-- product and silently delete the gate on the whole `_protected` tree — a
-- two-line change that disables an application-wide control.
--
-- CG-028's approach cannot be extended to cover it either: `handle_new_user` is
-- AFTER INSERT, and a magic-link user's row exists before the link is clicked.
--
-- The mailbox proof lives in the SESSION instead, where it belongs: GoTrue
-- records `amr: [{ method: 'otp' }]` for a passcode or magic-link sign-in, and
-- `readSessionClaims` (`_shared/auditEvidence.ts`) already extracts `amr` from a
-- token that `auth.getUser()` has just verified. `assertSignerAccount` widens
-- its second condition to accept that as proof — per session, never persisted,
-- failing closed on a missing or malformed claim. No schema change, and no new
-- writer to the column that gates the authenticated app.

-- ---------------------------------------------------------------------------
-- PHASE 8: GRANTS
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE to anon and authenticated on every
-- new function in `public`, so the safe state is NOT the default — CG-010
-- installed the tripwire below precisely because a migration that stays silent
-- here creates an open SECURITY DEFINER function. `signer_token_redeem` needs it
-- restated too: it was dropped and recreated above, which reset its ACL, and
-- CG-028 learned the same lesson the same way.

REVOKE EXECUTE ON FUNCTION public.signer_otp_issue(TEXT, INTEGER, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_otp_verify(TEXT, TEXT, TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT, BOOLEAN)       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.signer_otp_issue(TEXT, INTEGER, TEXT)           TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_otp_verify(TEXT, TEXT, TEXT)             TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT, BOOLEAN)        TO service_role;

COMMENT ON FUNCTION public.signer_otp_issue(TEXT, INTEGER, TEXT) IS
    'Mints and records a one-time passcode against a signer access token '
    '(CG-031). Returns the plaintext exactly once, to the edge function that '
    'hands it to the OTP driver. Enforces the resend cooldown and the hourly cap '
    'inside the statement so concurrent requests cannot race past them. '
    'service_role only.';

COMMENT ON FUNCTION public.signer_otp_verify(TEXT, TEXT, TEXT) IS
    'Redeems a one-time passcode (CG-031). Charges the attempt and tests the '
    'bcrypt hash in one statement so parallel guesses cannot exceed the cap, and '
    'stamps signer_access_tokens.otp_verified_at only on a match. '
    'service_role only.';

-- ---------------------------------------------------------------------------
-- PHASE 9: VERIFY
-- ---------------------------------------------------------------------------
-- The attempt cap and the match are the two things a six-digit code's safety
-- rests on, and both live inside one statement where they cannot be checked by
-- reading the call site. CG-015 set the precedent for proving that here.

DO $$
DECLARE
    v_signer   TEXT;
    v_request  TEXT;
    v_org      TEXT;
    v_token    TEXT := '_cg031_probe_' || repeat('a', 52);
    v_token_id TEXT;
    v_code     TEXT;
    v_issue    RECORD;
    v_verify   RECORD;
    v_failed   TEXT[] := ARRAY[]::TEXT[];
    i          INTEGER;
BEGIN
    SELECT s.id, s.request_id, s.organization_id
      INTO v_signer, v_request, v_org
      FROM public.signature_request_signers s
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-031: no signer rows to probe against; behavioural checks skipped.';
        RETURN;
    END IF;

    INSERT INTO public.signer_access_tokens
        (token_hash, signer_id, request_id, organization_id, purpose, expires_at, max_uses)
    VALUES
        (v_token, v_signer, v_request, v_org, 'sign', now() + interval '1 hour', 100)
    RETURNING id INTO v_token_id;

    SELECT * INTO v_issue FROM public.signer_otp_issue(v_token_id, 10, NULL);
    IF v_issue.status IS DISTINCT FROM 'sent' THEN
        v_failed := v_failed || format('first issue reported %s, expected sent', v_issue.status);
    END IF;
    IF v_issue.code !~ '^[0-9]{6}$' THEN
        v_failed := v_failed || format('issued code %L is not six digits', v_issue.code);
    END IF;
    v_code := v_issue.code;

    -- The cooldown has to bite on the very next call, or "resend" is an
    -- inbox-flooding primitive.
    SELECT * INTO v_issue FROM public.signer_otp_issue(v_token_id, 10, NULL);
    IF v_issue.status IS DISTINCT FROM 'cooldown' THEN
        v_failed := v_failed || format('immediate resend reported %s, expected cooldown', v_issue.status);
    END IF;

    -- A wrong code costs an attempt. If it did not, the cap would be decorative.
    SELECT * INTO v_verify FROM public.signer_otp_verify(v_token_id, '000000', NULL);
    IF v_verify.status IS DISTINCT FROM 'invalid' THEN
        v_failed := v_failed || format('wrong code reported %s, expected invalid', v_verify.status);
    END IF;
    IF v_verify.attempts_remaining IS DISTINCT FROM 4 THEN
        v_failed := v_failed || format('wrong code left %s attempts, expected 4', v_verify.attempts_remaining);
    END IF;

    -- Spend the rest, then confirm the challenge is dead rather than merely
    -- unlucky — and that the RIGHT code no longer opens it.
    FOR i IN 1..4 LOOP
        PERFORM public.signer_otp_verify(v_token_id, '000000', NULL);
    END LOOP;

    SELECT * INTO v_verify FROM public.signer_otp_verify(v_token_id, v_code, NULL);
    IF v_verify.status IS DISTINCT FROM 'locked' THEN
        v_failed := v_failed || format('correct code after the cap reported %s, expected locked', v_verify.status);
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.signer_access_tokens
         WHERE id = v_token_id AND otp_verified_at IS NOT NULL
    ) THEN
        v_failed := v_failed || 'a locked-out challenge still marked the token verified';
    END IF;

    -- A fresh challenge on the same token must work: lockout is per challenge,
    -- not a permanent ban on a credential the sender legitimately issued.
    UPDATE public.signer_otp_challenges
       SET created_at = created_at - interval '2 minutes'
     WHERE token_id = v_token_id;

    SELECT * INTO v_issue FROM public.signer_otp_issue(v_token_id, 10, NULL);
    IF v_issue.status IS DISTINCT FROM 'sent' THEN
        v_failed := v_failed || format('re-issue after cooldown reported %s, expected sent', v_issue.status);
    END IF;

    SELECT * INTO v_verify FROM public.signer_otp_verify(v_token_id, v_issue.code, NULL);
    IF v_verify.status IS DISTINCT FROM 'verified' THEN
        v_failed := v_failed || format('correct code reported %s, expected verified', v_verify.status);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.signer_access_tokens
         WHERE id = v_token_id AND otp_verified_at IS NOT NULL
    ) THEN
        v_failed := v_failed || 'a verified passcode did not mark the token';
    END IF;

    -- The verdict must be visible to the one call the signing surface makes,
    -- and asking for it must not have spent a use of the signer's link.
    IF (SELECT r.otp_verified_at FROM public.signer_token_redeem(v_token, NULL, FALSE) r) IS NULL THEN
        v_failed := v_failed || 'signer_token_redeem did not report otp_verified_at';
    END IF;

    IF (SELECT t.use_count FROM public.signer_access_tokens t WHERE t.id = v_token_id) <> 0 THEN
        v_failed := v_failed || 'p_count_use = false still spent a use';
    END IF;

    IF (SELECT r.use_count FROM public.signer_token_redeem(v_token, NULL) r) IS DISTINCT FROM 1 THEN
        v_failed := v_failed || 'a counting redemption did not report use_count 1';
    END IF;

    DELETE FROM public.signer_otp_challenges WHERE token_id = v_token_id;
    DELETE FROM public.signer_access_tokens WHERE id = v_token_id;

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-031: passcode routines are wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-031: passcode issue/verify behave as the signing surface assumes.';
END $$;

-- The grant check, SCOPED TO THE THREE FUNCTIONS THIS FILE CREATES.
--
-- CG-010 and CG-015 each re-ran the WHOLE-SCHEMA scan with an inline allowlist,
-- and that allowlist has since rotted: CG-018's notification RPCs, CG-023's
-- membership management, CG-024, CG-027's `has_org_permission` /
-- `get_my_org_capabilities` and `is_whitelisted` are all legitimately
-- `authenticated`-reachable and all postdate the array. Copying the snapshot
-- forward a third time would fail this migration for ten functions that are
-- exactly as they should be — and the fix for such a failure is to pad the list,
-- which trains everyone to pad the list, which is how a real leak gets waved
-- through.
--
-- So this asserts the invariant it can actually own: nothing THIS migration
-- created or recreated is reachable without the service key. The whole-schema
-- sweep stays where it belongs, in CG-010, as a single maintained list rather
-- than a copy in every file that adds a function.
DO $$
DECLARE
    v_leaks TEXT;
BEGIN
    SELECT string_agg(
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               E'\n  ')
      INTO v_leaks
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname IN ('signer_otp_issue', 'signer_otp_verify', 'signer_token_redeem')
       AND (
             has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-031: passcode function(s) reachable by anon/authenticated:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-031: passcode functions are service_role only.';
END $$;

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-031: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'signer_otp_challenges'
    ) THEN
        RAISE EXCEPTION
            'CG-031: signer_otp_challenges must have NO RLS policies; it holds credentials.';
    END IF;

    IF NOT (
        SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.signer_otp_challenges'::regclass
    ) THEN
        RAISE EXCEPTION 'CG-031: RLS is not enabled on signer_otp_challenges.';
    END IF;

    RAISE NOTICE 'CG-031: passcode surface verified — RLS on, zero policies, service_role only.';
END $$;
