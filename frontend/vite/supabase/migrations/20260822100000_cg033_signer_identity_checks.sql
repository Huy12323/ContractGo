-- ===========================================================================
-- CG-033 — IDENTITY CHECKS (eKYC), BUILT TO BE REMOVABLE
-- ===========================================================================
--
-- CG-031 answers "did whoever opened this link control the named mailbox?".
-- This answers a DIFFERENT question: "is the human at the keyboard who they
-- claim to be in the world?" A document check and a liveness selfie against a
-- government ID prove something a passcode never can.
--
-- ═══ THE ORTHOGONALITY ARGUMENT — read this before touching the schema ═══
--
-- An identity check is NOT a third value on `signature_requests_signer_auth_enum`,
-- and the reason is modelling before anything else. The two questions COMPOSE:
-- a high-value envelope wants a passcode AND a document check. Putting eKYC on
-- that enum would force two orthogonal axes to exclude one another, which is a
-- bug that would have to be un-modelled later even if PostgreSQL allowed
-- dropping an enum value.
--
-- That it would ALSO make the feature permanently un-removable at the schema
-- level is the corroborating argument, not the case. It matters here because
-- this project may not keep eKYC: the requirement is that it can be torn out
-- without disturbing anything else. So it is a BOOLEAN plus its own table plus
-- its own `CREATE TYPE` — a created type is droppable once unreferenced, and
-- removal is `DROP TABLE` + `DROP TYPE` + two `DROP FUNCTION`s + two column
-- drops. Nothing in that list touches CG-031, CG-032 or the token machinery.
--
-- ═══ A BOOLEAN AND NOT A `level` ENUM ═══
--
-- Not because an enum type is un-droppable — a dedicated `CREATE TYPE` is
-- perfectly droppable; only VALUES on an existing type are permanent. The
-- argument is honesty: there is one driver with one verdict axis, and a
-- `basic | document | document_liveness` column would render into a dropdown
-- where two of three options silently do nothing. A fixed-value column whose
-- values nothing implements is a lie in the schema. Levels stay available at
-- zero cost — this boolean remains the on/off switch, and a nullable
-- `identity_check_level` column is added beside it the day a driver has levels.
--
-- ═══ KEYED ON THE SIGNER, NOT THE TOKEN — the one departure from CG-031 ═══
--
-- CG-031 hung `otp_verified_at` on `signer_access_tokens` for an excellent
-- reason: a passcode proves control of a mailbox NOW, so it must die with the
-- credential a resend withdraws. THAT REASONING DOES NOT TRANSFER. An identity
-- verdict is a durable fact about a PERSON. Re-running a document-and-liveness
-- check on every resend is hostile to the signer and, with a real vendor,
-- billable per attempt.
--
-- `token_id` is recorded as EVIDENCE of which credential the check ran under,
-- `ON DELETE SET NULL`, so revoking a link never destroys the verdict it
-- produced. Staleness is a nullable driver-supplied `expires_at`, not a
-- freshness window. Confirmed safe by inspection: `envelopes_resend` and
-- `envelopes_request-changes` re-mint tokens but never rebuild
-- `signature_request_signers` rows, so both new columns survive a resend by
-- construction.
--
-- ═══ THE AUDIT VALUES ARE NAMED FOR THE ACT, NOT THE VENDOR CATEGORY ═══
--
-- `signer_identity_started` / `_verified` / `_failed`, NOT `signer_ekyc_*`.
-- This is the highest-leverage removability decision in the whole version and
-- it costs nothing. "eKYC" is a vendor category; "identity check" is the act.
-- If the driver is torn out and a notary flow, a national eID or a bank-ID
-- handshake lands later, these permanent values are still the right words and
-- get REUSED rather than joined by a fourth vocabulary.
--
-- Adding three permanent values does not violate the removability requirement,
-- and the reason has three parts: (i) `signature_audit_log.event_type` IS an
-- enum — there is no TEXT escape hatch, so this is not a choice; (ii) the rows
-- written with them are a legally-required historical record that could not be
-- deleted even if PostgreSQL allowed dropping the value, so permanence here is
-- a REQUIREMENT rather than a cost; (iii) an unused value is one `pg_enum` row
-- and one union member that no code constructs. The only lever removability
-- leaves is the NAME, and this pulls it.
--
-- ═══ ONE FILE IS SAFE HERE, FOR EXACTLY CG-031'S REASON ═══
--
-- PostgreSQL forbids an enum value added in a transaction from being REFERENCED
-- in that same transaction, and `db push` runs each migration in one. But
-- `signature_audit_append` declares `p_event_type TEXT` and casts inside, and
-- the only writer of the three values added in PHASE 6 is edge-function
-- TypeScript running long after this commits.
--
-- **DO NOT ADD AN AUDIT-WRITING STATEMENT TO THIS FILE'S BEHAVIOURAL PROBE.**
-- That is the one thing that would break it. The probe below touches only
-- `signer_identity_checks` and `signer_access_tokens`, deliberately. If chaining
-- an entry from here ever becomes necessary, SPLIT the `ALTER TYPE` block into
-- its own migration rather than reaching for a workaround.
--
-- (`signer_identity_checks_status_enum` is a `CREATE TYPE`, not an
-- `ALTER TYPE ADD VALUE` — a freshly created type IS usable in the same
-- transaction, so the table DDL and the probe are safe together. Extending an
-- existing enum for the status would have failed in this same file.)
--
-- ═══ NO EXISTING FUNCTION IS DROPPED OR RECREATED ═══
--
-- `resolveSignerToken` already has `ctx.signer.id`, so the gate reads the new
-- table directly and `signer_token_redeem` is untouched. Contrast CG-031 PHASE
-- 5, which had to DROP/CREATE and therefore had to restate an ACL. Nothing here
-- resets one.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- PHASE 1: THE REQUIREMENT
-- ---------------------------------------------------------------------------
-- Same inheritance rule as CG-032: NULL on the signer row means take the
-- envelope's answer. `false` at the envelope level is what makes this migration
-- invisible to every document in flight and every saved draft.

ALTER TABLE public.signature_requests
    ADD COLUMN require_identity_check BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.signature_requests.require_identity_check IS
    'Whether recipients must pass a government-ID identity check before signing '
    '(CG-033). ORTHOGONAL to signer_auth, not a value on it: signer_auth asks '
    '"did they control the named mailbox", this asks "are they who they claim '
    'to be in the world", and a high-value envelope wants both. Pinned at send '
    'time like every other term of the send. Designed to be droppable — see the '
    'migration header.';

ALTER TABLE public.signature_request_signers
    ADD COLUMN require_identity_check BOOLEAN;

COMMENT ON COLUMN public.signature_request_signers.require_identity_check IS
    'Per-recipient override of signature_requests.require_identity_check '
    '(CG-033). NULL means INHERIT, which is every row that existed before this '
    'migration. Same inheritance rule as auth_method (CG-032); resolved in '
    'TypeScript by resolveEffectiveIdentityCheck().';

-- An observer never authenticates — `assertCanAct` refuses their `view` token
-- before the identity gate is reached — so a requirement stored on one would be
-- a control the composer renders and the server can never honour. The twin of
-- CG-032's `auth_method` check, and named for its own column so a failure says
-- which rule was broken.
ALTER TABLE public.signature_request_signers
    ADD CONSTRAINT signature_request_signers_identity_check_check
    CHECK (recipient_type = 'signer' OR require_identity_check IS NULL);

-- ---------------------------------------------------------------------------
-- PHASE 2: THE VERDICT VOCABULARY
-- ---------------------------------------------------------------------------
-- Exactly `IdentityDriver.getVerdict`'s three answers in `_shared/signing.ts`,
-- and no more. A fourth value such as 'expired' would be one only WE could
-- write, giving the column two authorities and making "what does this row mean"
-- depend on which of them wrote it last. Abandonment is expressible without it:
-- `status = 'pending' AND expires_at < now()`.

CREATE TYPE public.signer_identity_checks_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected'
);

-- ---------------------------------------------------------------------------
-- PHASE 3: THE ATTEMPT RECORD
-- ---------------------------------------------------------------------------

CREATE TABLE public.signer_identity_checks (
    id TEXT PRIMARY KEY DEFAULT generate_id('sic'),

    signer_id  TEXT NOT NULL REFERENCES public.signature_request_signers(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- EVIDENCE, NOT OWNERSHIP. Which credential this check ran under, so the
    -- trail can say so — but `SET NULL` rather than `CASCADE`, because revoking
    -- a link must never destroy the verdict it produced. That is the whole
    -- signer-keyed vs token-keyed decision, expressed as one referential action.
    token_id TEXT REFERENCES public.signer_access_tokens(id) ON DELETE SET NULL,

    -- `IdentityDriverName` verbatim ('mock' | 'ekyc_vendor'). Recorded so a
    -- mock-approved check can NEVER be mistaken for a vendor-approved one — the
    -- same discipline `signatures.provider` applies to the signing driver.
    provider TEXT NOT NULL,
    -- The vendor's opaque handle for the session. NOT a secret to log: see the
    -- table comment. Unique because it is what a verdict is matched back on.
    provider_session_id TEXT NOT NULL,

    status public.signer_identity_checks_status_enum NOT NULL DEFAULT 'pending',
    -- The vendor's confidence, 0..1. NEVER returned to the client — it is a
    -- figure an attacker could tune retries against.
    score NUMERIC(4,3),
    -- Vendor free text, truncated by `signer_identity_record_verdict`. Free text
    -- from a third party is the leak vector, not the columns you designed.
    rejection_reason TEXT,

    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    -- Driver-supplied staleness. NULL means the verdict does not expire.
    expires_at  TIMESTAMPTZ,

    started_ip  INET,
    resolved_ip INET,

    CONSTRAINT signer_identity_checks_score_check
        CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
    -- 'pending' and 'resolved_at IS NULL' are two spellings of the same fact.
    -- Tying them means a row can never claim to be undecided and timestamped.
    CONSTRAINT signer_identity_checks_resolution_check
        CHECK ((status = 'pending') = (resolved_at IS NULL)),
    CONSTRAINT signer_identity_checks_rejection_reason_check
        CHECK (rejection_reason IS NULL OR status = 'rejected')
);

COMMENT ON TABLE public.signer_identity_checks IS
    'Identity-check attempts and verdicts for external signers (CG-033). RLS is '
    'enabled with NO policies at all, like signer_access_tokens and '
    'signer_otp_challenges: reachable only by the SECURITY DEFINER routines '
    'below. '
    'THIS TABLE MAY NEVER HOLD PERSONAL IDENTITY MATERIAL. No document or ID '
    'numbers, no document or selfie images, no biometric templates, no date of '
    'birth, no address. provider_session_id is an opaque vendor handle and '
    'nothing more. Retention and erasure of the underlying material are the '
    'vendor''s — which is the entire reason the driver seam returns a VERDICT '
    'and not a payload. The pressure to add "just the document number, for '
    'support" arrives with the first real vendor; the answer is no.';

CREATE UNIQUE INDEX idx_signer_identity_checks_provider_session
    ON public.signer_identity_checks(provider_session_id);
CREATE INDEX idx_signer_identity_checks_signer_id
    ON public.signer_identity_checks(signer_id);
CREATE INDEX idx_signer_identity_checks_request_id
    ON public.signer_identity_checks(request_id);
CREATE INDEX idx_signer_identity_checks_organization_id
    ON public.signer_identity_checks(organization_id);
-- The gate's read, on every submit of an identity-checked envelope: "this
-- signer's newest live approval". Partial qualifier last, per convention.
CREATE INDEX idx_signer_identity_checks_signer_id_approved
    ON public.signer_identity_checks(signer_id, resolved_at DESC)
    WHERE status = 'approved';

-- CG-005's 1-hop convention: organization_id is derived from the parent request
-- rather than trusted from the caller. Reuses the function CG-031 reused.
CREATE TRIGGER trigger_set_org_id_signer_identity_checks
    BEFORE INSERT ON public.signer_identity_checks
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

ALTER TABLE public.signer_identity_checks ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies. See the table comment.
--
-- And deliberately no `senders_can_view_…` policy either: the verdict is already
-- in the audit chain (`AuditAuth.ekyc` is hashed into `signature_audit_log`,
-- org-scoped, immutable, and `App_EnvelopeTimeline` already renders that slot),
-- so the sender UI has its data source without this table. One fewer thing the
-- removal recipe has to reason about. If a sender-facing list is ever required,
-- add the policy in its own migration.
--
-- NO `REVOKE ALL ON TABLE`, deliberately. Only `cron_dispatch_config` carries
-- that, and CG-025 set `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon,
-- authenticated, service_role` with a shipped VERIFY block asserting every table
-- EXCEPT that one has SELECT for `authenticated`. Revoking table grants here
-- would contradict a shipped assertion. RLS-with-zero-policies is default-deny
-- and is the convention.

-- ---------------------------------------------------------------------------
-- PHASE 4: START
-- ---------------------------------------------------------------------------
-- Mirrors `signer_otp_issue` closely, including the two things that are easy to
-- get wrong:
--
--   * A dead credential is reported as a STATUS, not a RAISE, so the endpoint
--     cannot become an oracle for probing which emailed links are still live.
--   * The throttle is IN THE STATEMENT. A read-then-write check in TypeScript is
--     two round trips with a gap, and two concurrent POSTs both slip through it.
--     With a real vendor each slip is a billable charge.
--
-- And one thing CG-031 had no need for: `already_approved`. A signer who has
-- passed must not be re-billed and re-photographed because the sender pressed
-- resend. That short-circuit IS the signer-keyed decision, made operational.
--
-- Every table reference is ALIASED. `status` and `expires_at` are both column
-- names AND OUT parameters here, and plpgsql resolves the bare name to the
-- variable — CG-031's comment calls this "not a style question, it is a
-- silently wrong query".

CREATE OR REPLACE FUNCTION public.signer_identity_start(
    p_token_id TEXT,
    p_provider TEXT,
    p_provider_session_id TEXT,
    p_ttl_minutes INTEGER DEFAULT 30,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(status TEXT, check_id TEXT, expires_at TIMESTAMPTZ, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    -- One start a minute. Generous for a human whose camera failed, useless as a
    -- way to spend the sender's vendor budget.
    c_cooldown_seconds CONSTANT INTEGER := 60;
    -- Five an hour per token. The only cap that exists: `countUse: false` means
    -- the token's use counter deliberately does NOT bound this, so these two
    -- decisions pull in opposite directions ON PURPOSE and neither may later be
    -- dropped as redundant.
    c_max_per_hour     CONSTANT INTEGER := 5;

    v_signer_id  TEXT;
    v_request_id TEXT;
    v_last_at    TIMESTAMPTZ;
    v_recent     INTEGER;
    v_expires    TIMESTAMPTZ := now() + make_interval(mins => p_ttl_minutes);
    v_id         TEXT;
BEGIN
    SELECT t.signer_id, t.request_id
      INTO v_signer_id, v_request_id
      FROM public.signer_access_tokens t
     WHERE t.id = p_token_id
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now();

    IF v_signer_id IS NULL THEN
        RETURN QUERY SELECT 'invalid_token'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
        RETURN;
    END IF;

    -- THE ANTI-RE-BILLING SHORT CIRCUIT, and the reason this table is keyed on
    -- the signer. An unexpired approval already answers the question a new
    -- session would ask, so a resend costs nothing and asks the signer for
    -- nothing.
    SELECT c.id INTO v_id
      FROM public.signer_identity_checks c
     WHERE c.signer_id = v_signer_id
       AND c.status = 'approved'
       AND (c.expires_at IS NULL OR c.expires_at > now())
     ORDER BY c.resolved_at DESC
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        RETURN QUERY SELECT 'already_approved'::TEXT, v_id, NULL::TIMESTAMPTZ, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT max(c.started_at), count(*) FILTER (WHERE c.started_at > now() - interval '1 hour')
      INTO v_last_at, v_recent
      FROM public.signer_identity_checks c
     WHERE c.token_id = p_token_id;

    IF v_last_at IS NOT NULL AND v_last_at > now() - make_interval(secs => c_cooldown_seconds) THEN
        RETURN QUERY SELECT
            'cooldown'::TEXT,
            NULL::TEXT,
            NULL::TIMESTAMPTZ,
            ceil(extract(epoch FROM (v_last_at + make_interval(secs => c_cooldown_seconds)) - now()))::INTEGER;
        RETURN;
    END IF;

    IF v_recent >= c_max_per_hour THEN
        RETURN QUERY SELECT 'rate_limited'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
        RETURN;
    END IF;

    -- Supersede any live pending check for this SIGNER — not merely this token —
    -- so `signer_identity_record_verdict`'s single-row match is unambiguous even
    -- after a resend handed them a second credential. Marked rejected rather
    -- than deleted: an abandoned attempt is still a record that one was made,
    -- and the resolution CHECK forbids leaving `resolved_at` null on a
    -- non-pending row.
    UPDATE public.signer_identity_checks c
       SET status = 'rejected',
           resolved_at = now(),
           rejection_reason = 'superseded by a newer attempt'
     WHERE c.signer_id = v_signer_id
       AND c.status = 'pending';

    INSERT INTO public.signer_identity_checks
        (signer_id, request_id, token_id, provider, provider_session_id, expires_at, started_ip)
    VALUES
        (v_signer_id, v_request_id, p_token_id, p_provider, p_provider_session_id, v_expires, p_ip::inet)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT 'started'::TEXT, v_id, v_expires, NULL::INTEGER;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 5: RECORD THE VERDICT
-- ---------------------------------------------------------------------------
-- ONE STATEMENT, AND MATCHING ON 'pending' IN THE WHERE CLAUSE IS WHAT MAKES A
-- VERDICT WRITE-ONCE. A second call carrying a different answer matches no row
-- and returns 'not_pending' — so a replayed or forged vendor callback cannot
-- turn a rejection into an approval.
--
-- `rejection_reason` is truncated to 200 characters. Vendor free text is where
-- personal material leaks into a table designed not to hold any.

CREATE OR REPLACE FUNCTION public.signer_identity_record_verdict(
    p_check_id TEXT,
    p_status TEXT,
    p_score NUMERIC DEFAULT NULL,
    p_rejection_reason TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(status TEXT, signer_id TEXT, request_id TEXT, provider TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_signer   TEXT;
    v_request  TEXT;
    v_provider TEXT;
BEGIN
    IF p_status NOT IN ('approved', 'rejected') THEN
        -- 'pending' is not a verdict, it is the absence of one, and the caller
        -- must not write it here. Refused as a status rather than a RAISE, for
        -- the same reason `invalid_token` is.
        RETURN QUERY SELECT 'invalid_status'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    UPDATE public.signer_identity_checks c
       SET status = p_status::public.signer_identity_checks_status_enum,
           resolved_at = now(),
           score = p_score,
           rejection_reason = CASE
               WHEN p_status = 'rejected' THEN left(p_rejection_reason, 200)
               ELSE NULL
           END,
           resolved_ip = COALESCE(p_ip::inet, c.resolved_ip)
     WHERE c.id = p_check_id
       AND c.status = 'pending'
    RETURNING c.signer_id, c.request_id, c.provider
         INTO v_signer, v_request, v_provider;

    IF v_signer IS NULL THEN
        RETURN QUERY SELECT 'not_pending'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT p_status, v_signer, v_request, v_provider;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 6: AUDIT EVENT TYPES
-- ---------------------------------------------------------------------------
-- Named for the ACT rather than the vendor category — see the header. Written
-- only by `signing_identity_start` and `signing_identity_verify`, both of which
-- run long after this migration commits, so adding them here is safe.

ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_identity_started';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_identity_verified';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_identity_failed';

-- ---------------------------------------------------------------------------
-- PHASE 7: GRANTS
-- ---------------------------------------------------------------------------
-- THE `FROM PUBLIC, anon, authenticated` IS NOT BELT AND BRACES. Supabase's
-- `pg_default_acl` grants EXECUTE to both roles EXPLICITLY on every new function
-- in `public`, so a bare `REVOKE … FROM PUBLIC` is INERT — it removes a grant
-- that was never the one in effect. CG-010 learned this the hard way; naming the
-- roles is the fix, and `has_function_privilege` below is how it is proven.

REVOKE EXECUTE ON FUNCTION public.signer_identity_start(TEXT, TEXT, TEXT, INTEGER, TEXT)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.signer_identity_record_verdict(TEXT, TEXT, NUMERIC, TEXT, TEXT)            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.signer_identity_start(TEXT, TEXT, TEXT, INTEGER, TEXT)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_identity_record_verdict(TEXT, TEXT, NUMERIC, TEXT, TEXT)             TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 8: VERIFY
-- ---------------------------------------------------------------------------

-- (1) BEHAVIOURAL. The throttle, the write-once verdict and the anti-re-billing
--     short circuit are the three things this feature's cost and correctness
--     rest on, and all three live inside statements that cannot be checked by
--     reading the call site.
--
--     APPENDS NO AUDIT ROW, deliberately — see the header's ONE FILE IS SAFE
--     section. Do not add one.
DO $$
DECLARE
    v_signer   TEXT;
    v_request  TEXT;
    v_org      TEXT;
    v_token    TEXT := '_cg033_probe_' || repeat('b', 52);
    v_token_id TEXT;
    v_start    RECORD;
    v_verdict  RECORD;
    v_check    TEXT;
    v_failed   TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT s.id, s.request_id, s.organization_id
      INTO v_signer, v_request, v_org
      FROM public.signature_request_signers s
     WHERE s.recipient_type = 'signer'
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-033: no signer rows to probe against; behavioural checks skipped.';
        RETURN;
    END IF;

    INSERT INTO public.signer_access_tokens
        (token_hash, signer_id, request_id, organization_id, purpose, expires_at, max_uses)
    VALUES
        (v_token, v_signer, v_request, v_org, 'sign', now() + interval '1 hour', 100)
    RETURNING id INTO v_token_id;

    -- START
    SELECT * INTO v_start
      FROM public.signer_identity_start(v_token_id, 'mock', '_cg033_probe_session_1', 30, NULL);
    IF v_start.status IS DISTINCT FROM 'started' THEN
        v_failed := v_failed || format('first start reported %s, expected started', v_start.status);
    END IF;
    v_check := v_start.check_id;

    -- The cooldown has to bite on the very next call, or "try again" is a way to
    -- spend the sender's vendor budget.
    SELECT * INTO v_start
      FROM public.signer_identity_start(v_token_id, 'mock', '_cg033_probe_session_2', 30, NULL);
    IF v_start.status IS DISTINCT FROM 'cooldown' THEN
        v_failed := v_failed || format('immediate restart reported %s, expected cooldown', v_start.status);
    END IF;

    -- A verdict resolves the pending row.
    SELECT * INTO v_verdict
      FROM public.signer_identity_record_verdict(v_check, 'approved', 0.97, NULL, NULL);
    IF v_verdict.status IS DISTINCT FROM 'approved' THEN
        v_failed := v_failed || format('verdict reported %s, expected approved', v_verdict.status);
    END IF;
    IF v_verdict.signer_id IS DISTINCT FROM v_signer THEN
        v_failed := v_failed || 'verdict did not return the signer it resolved';
    END IF;

    -- WRITE-ONCE. A second verdict on the same check must not overwrite the
    -- first — otherwise a replayed callback turns a rejection into an approval.
    SELECT * INTO v_verdict
      FROM public.signer_identity_record_verdict(v_check, 'rejected', 0.10, 'replay', NULL);
    IF v_verdict.status IS DISTINCT FROM 'not_pending' THEN
        v_failed := v_failed || format('second verdict reported %s, expected not_pending', v_verdict.status);
    END IF;
    IF (SELECT c.status FROM public.signer_identity_checks c WHERE c.id = v_check)
       IS DISTINCT FROM 'approved' THEN
        v_failed := v_failed || 'a replayed verdict overwrote an approval';
    END IF;

    -- 'pending' is not a verdict.
    SELECT * INTO v_verdict
      FROM public.signer_identity_record_verdict(v_check, 'pending', NULL, NULL, NULL);
    IF v_verdict.status IS DISTINCT FROM 'invalid_status' THEN
        v_failed := v_failed || format('pending-as-verdict reported %s, expected invalid_status', v_verdict.status);
    END IF;

    -- THE ANTI-RE-BILLING SHORT CIRCUIT. Wind the cooldown back so it is not the
    -- thing being tested, then confirm an approved signer is not asked again.
    UPDATE public.signer_identity_checks c
       SET started_at = c.started_at - interval '2 minutes'
     WHERE c.token_id = v_token_id;

    SELECT * INTO v_start
      FROM public.signer_identity_start(v_token_id, 'mock', '_cg033_probe_session_3', 30, NULL);
    IF v_start.status IS DISTINCT FROM 'already_approved' THEN
        v_failed := v_failed || format('start for an approved signer reported %s, expected already_approved', v_start.status);
    END IF;

    -- A dead credential is a status, never an exception — this endpoint must not
    -- be an oracle for which emailed links are live.
    UPDATE public.signer_access_tokens SET revoked_at = now() WHERE id = v_token_id;
    SELECT * INTO v_start
      FROM public.signer_identity_start(v_token_id, 'mock', '_cg033_probe_session_4', 30, NULL);
    IF v_start.status IS DISTINCT FROM 'invalid_token' THEN
        v_failed := v_failed || format('revoked token reported %s, expected invalid_token', v_start.status);
    END IF;

    -- And the verdict outlives the credential — that is the whole ON DELETE SET
    -- NULL decision.
    DELETE FROM public.signer_access_tokens WHERE id = v_token_id;
    IF NOT EXISTS (
        SELECT 1 FROM public.signer_identity_checks c
         WHERE c.id = v_check AND c.status = 'approved' AND c.token_id IS NULL
    ) THEN
        v_failed := v_failed || 'deleting the token destroyed or orphaned the verdict it produced';
    END IF;

    DELETE FROM public.signer_identity_checks WHERE signer_id = v_signer
       AND provider_session_id LIKE '\_cg033\_probe\_%';

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-033: identity-check routines are wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-033: start/verdict behave as the signing surface assumes.';
END $$;

-- (2) GRANTS, SCOPED TO THE TWO FUNCTIONS THIS FILE CREATES.
--
-- CG-031's scoped form, NOT CG-010's whole-schema allowlist. That allowlist has
-- rotted — CG-018/023/024/027 added RPCs that are legitimately
-- `authenticated`-reachable and postdate the array, so copying it forward fails
-- for ten functions that are exactly as they should be. The fix for such a
-- failure is to pad the list, which trains everyone to pad the list, which is
-- how a real leak gets waved through. This asserts the invariant it can own.
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
       AND p.proname IN ('signer_identity_start', 'signer_identity_record_verdict')
       AND (
             has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-033: identity function(s) reachable by anon/authenticated:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-033: identity functions are service_role only.';
END $$;

-- (3) The standing whole-schema invariant CG-009 established: nothing anywhere
--     hands `anon` an RLS policy.
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-033: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;

-- (4) The new table's own surface.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'signer_identity_checks'
    ) THEN
        RAISE EXCEPTION
            'CG-033: signer_identity_checks must have NO RLS policies; the audit chain is the sender''s data source.';
    END IF;

    IF NOT (
        SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.signer_identity_checks'::regclass
    ) THEN
        RAISE EXCEPTION 'CG-033: RLS is not enabled on signer_identity_checks.';
    END IF;

    RAISE NOTICE 'CG-033: identity surface verified — RLS on, zero policies, service_role only.';
END $$;

-- (5) ADDITIVE SAFETY. The claim that makes this migration invisible to every
--     document in flight: nothing requires an identity check yet.
DO $$
DECLARE
    v_requests INT;
    v_signers  INT;
BEGIN
    SELECT count(*) INTO v_requests
      FROM public.signature_requests WHERE require_identity_check;
    SELECT count(*) INTO v_signers
      FROM public.signature_request_signers WHERE require_identity_check IS NOT NULL;

    IF v_requests > 0 OR v_signers > 0 THEN
        RAISE EXCEPTION
            'CG-033: % request(s) and % signer row(s) already require an identity check; expected 0 of each.',
            v_requests, v_signers;
    END IF;

    RAISE NOTICE 'CG-033: no existing document or recipient requires an identity check.';
END $$;
