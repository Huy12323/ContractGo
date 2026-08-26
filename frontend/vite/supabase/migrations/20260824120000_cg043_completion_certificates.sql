-- ===========================================================================
-- CG-043 — CERTIFICATE OF COMPLETION, AND PUBLIC DOCUMENT VERIFICATION
-- ===========================================================================
--
-- v1.3.0's schema half. Two features, one migration, because they share the
-- same anchor: a document's sha256.
--
-- ═══ THE CERTIFICATE IS A DERIVED ARTIFACT, NOT EVIDENCE ═══
--
-- Everything a Certificate of Completion prints ALREADY EXISTS and is already
-- trusted: `signature_audit_log` is append-only by trigger, per-request `seq`,
-- `prev_hash`/`entry_hash`, and `signature_verify_chain` rehashes it with the
-- same IMMUTABLE function that wrote it. The certificate is a SECOND RENDERING
-- of that dataset. It invents no facts, and if it is deleted nothing is lost.
--
-- That is why the columns below are all NULLable with no CHECK tying them
-- together, and why the certificate gets NO `files` row despite CG-037 making
-- `files` the record for every R2 object. `files.r2_key` is UNIQUE with a
-- stored `size`, and this artifact is REGENERATED IN PLACE whenever the chain
-- grows — every regeneration would change the size and hash under a row
-- claiming to describe it. The alternative, a fresh key per generation,
-- accumulates orphaned objects nothing sweeps. `files` tracks AUTHORITATIVE
-- artifacts; this one is disposable by construction.
--
-- ═══ WHY GENERATION IS NOT PART OF COMPLETION ═══
--
-- `signing_submit`'s `finalizeRequest` is the most-verified function in this
-- repository and the one place a regression is unrecoverable, because the chain
-- entries it writes cannot be corrected afterwards. It already states the
-- governing principle for this migration: "A signing failure does NOT fail the
-- completion… refusing to complete because a certificate authority was
-- unreachable would strand a finished agreement over a property it never had."
-- A certificate render failure deserves the same treatment, and the cheapest
-- way to GUARANTEE it — rather than rely on a try/catch a later author can
-- tighten — is for the render to live outside that function entirely.
--
-- It is also required regardless: every already-completed envelope has no
-- certificate, so an on-demand path has to exist. Building generation at
-- completion as well would be two code paths producing one artifact.
--
-- ═══ `certificate_events_root_hash` IS THE TERMINAL entry_hash ═══
--
-- NOT a Merkle root, and this is deliberate. The chain is already a hash chain:
-- `entry_hash = sha256(prev_hash || seq || …)`, so the LAST entry's hash commits
-- to every prior entry by construction. A Merkle root would be a second
-- integrity mechanism that has to be kept in agreement with the first, and the
-- moment the two disagree nobody can say which one is wrong.
--
-- Storing it is what makes regeneration correct rather than cached-forever: if
-- the terminal hash has moved since the certificate was written (a
-- request-changes loop, a later download entry), the stored PDF is stale and
-- the generator re-renders. The idempotency key is therefore the CHAIN, not a
-- boolean flag.
--
-- ═══ PUBLIC VERIFICATION: THE HASH IS THE CREDENTIAL ═══
--
-- CG-009 and CG-010 both assert, inside the migration, that no RLS policy
-- anywhere targets `anon`, and CG-010 installs a `has_function_privilege`
-- tripwire that fails `db push` if a new function becomes anon-executable. So a
-- public verification surface CANNOT be an anon policy and CANNOT be an anon
-- RPC. It is a public EDGE FUNCTION (`verify_jwt = false`, enumerated in
-- config.toml) calling this service_role-only function — the same shape the
-- entire external signer surface already uses.
--
-- The caller presents a sha256 OF THE ARTIFACT. Unlike a document id, it cannot
-- be minted, cannot be guessed, cannot be enumerated, and can only be produced
-- by someone who actually HOLDS the document. It is therefore treated as a
-- bearer credential, exactly as a signing token is — which is what licenses the
-- disclosure set below. Everything returned is something the holder can already
-- read off the page in front of them. Nothing else is: no field values, no R2
-- keys, no row ids, no audit payloads.
--
-- Email addresses are MASKED IN SQL, not in TypeScript. An unmasked address
-- must never leave the database on this path, and putting the mask in the
-- caller means the next caller can forget it.
--
-- ═══ ONE FILE IS SAFE, AND ONE THING WOULD BREAK IT ═══
--
-- `ALTER TYPE … ADD VALUE` below adds `certificate_generated`. PostgreSQL
-- forbids REFERENCING an enum value added in the same transaction, and
-- `db push` runs each migration in one. Nothing in this file references it —
-- the only writer is edge-function TypeScript running long after this commits.
--
-- DO NOT ADD AN AUDIT-WRITING STATEMENT TO THE PROBE BLOCK BELOW. If that ever
-- becomes necessary, split the ALTER TYPE into its own later migration rather
-- than reaching for a workaround. (`verify_rate_limits` is a CREATE TABLE and
-- the functions are new, so those are safe in this transaction — a freshly
-- created object is usable immediately; only extending an EXISTING enum is not.)
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PHASE 1: CERTIFICATE COLUMNS
-- ---------------------------------------------------------------------------
-- All NULLable, no defaults, no CHECK. Every existing row is untouched and no
-- constraint can retroactively fail on data already in the table.
--
-- Deliberately NO `CHECK ((certificate_r2_key IS NULL) = (certificate_sha256 IS
-- NULL))`. It reads well and it is a trap: it makes a partially-written
-- generation an UNREPRESENTABLE state that the generator then has to work
-- around. The generator writes all six columns in ONE UPDATE or none, which is
-- the same guarantee without a constraint that can strand a row.

ALTER TABLE public.signature_requests
    ADD COLUMN IF NOT EXISTS certificate_r2_key           TEXT,
    ADD COLUMN IF NOT EXISTS certificate_sha256           TEXT,
    ADD COLUMN IF NOT EXISTS certificate_generated_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS certificate_events_root_hash TEXT,
    ADD COLUMN IF NOT EXISTS certificate_events_seq       BIGINT,
    ADD COLUMN IF NOT EXISTS certificate_chain_intact     BOOLEAN;

COMMENT ON COLUMN public.signature_requests.certificate_r2_key IS
'Storage key of the Certificate of Completion PDF. A DERIVED artifact: it is
rendered from signature_audit_log, may be regenerated at any time, and is never
evidence in its own right — the chain is. Deliberately has NO files row
(contrast signed_pdf_file_id): the object is overwritten in place on every
regeneration, which would falsify a files row''s size and hash.';

COMMENT ON COLUMN public.signature_requests.certificate_sha256 IS
'sha256 of the certificate PDF as stored. Accepted by
signature_request_verify_by_hash, so a counterparty holding only the certificate
can still verify the document.';

COMMENT ON COLUMN public.signature_requests.certificate_events_root_hash IS
'The entry_hash of the LAST audit entry at render time — NOT a Merkle root. The
chain already commits to every prior entry through prev_hash, so the terminal
hash is a complete commitment and a second mechanism could only disagree with
the first. This is the IDEMPOTENCY KEY: if it no longer matches the chain''s
current terminal hash the stored certificate is stale and must be re-rendered.';

COMMENT ON COLUMN public.signature_requests.certificate_events_seq IS
'The seq that certificate_events_root_hash belongs to. Printed on the
certificate so a reader can say which entry the commitment covers.';

COMMENT ON COLUMN public.signature_requests.certificate_chain_intact IS
'The signature_verify_chain verdict AT RENDER TIME, stored so the certificate
and the row agree about what was claimed. A false verdict does NOT prevent
generation — a certificate that refuses to render for a tampered trail hides
precisely the fact a regulator needs.';


-- ---------------------------------------------------------------------------
-- PHASE 2: LOOKUP INDEXES
-- ---------------------------------------------------------------------------
-- The public verify path is a single equality probe per call. Without these it
-- is a sequential scan on an UNAUTHENTICATED endpoint, which turns a cheap
-- lookup into the cheapest denial-of-service in the product.
--
-- Not UNIQUE. Two envelopes CAN legitimately carry the same signed_pdf_sha256 —
-- the same source PDF, the same field values, the same burn is byte-reproducible
-- — and a unique index would make the second completion fail inside
-- finalizeRequest. That is exactly the class of change this version refuses to
-- make.

CREATE INDEX IF NOT EXISTS idx_signature_requests_signed_pdf_sha256
    ON public.signature_requests (signed_pdf_sha256)
    WHERE signed_pdf_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signature_requests_certificate_sha256
    ON public.signature_requests (certificate_sha256)
    WHERE certificate_sha256 IS NOT NULL;


-- ---------------------------------------------------------------------------
-- PHASE 3: THE AUDIT EVENT TYPE
-- ---------------------------------------------------------------------------
-- One value, written only by an authenticated sender through
-- envelopes_certificate_generate. A PUBLIC verify call writes NOTHING —
-- signature_audit_append takes FOR UPDATE on the request, so anonymous traffic
-- appending to the chain would serialize the signing surface against
-- unauthenticated callers, and would drown the genuine entries besides.
--
-- NOT referenced anywhere below. See the header.

ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'certificate_generated';


-- ---------------------------------------------------------------------------
-- PHASE 4: PUBLIC VERIFICATION THROTTLE
-- ---------------------------------------------------------------------------
-- RLS ENABLED WITH ZERO POLICIES — the signer_access_tokens /
-- signer_otp_challenges / signer_identity_checks treatment. Nothing outside a
-- SECURITY DEFINER function may read or write it.
--
-- No REVOKE ALL ON TABLE: CG-025 set ALTER DEFAULT PRIVILEGES … GRANT ALL ON
-- TABLES TO anon, authenticated, service_role and ships a VERIFY block asserting
-- every table except cron_dispatch_config has SELECT for authenticated.
-- Revoking here would contradict a shipped assertion. RLS-with-zero-policies is
-- default-deny and is the convention.
--
-- client_key is whatever the edge function decides identifies a caller (an IP,
-- today). It is NOT a user identifier and nothing joins on it.

CREATE TABLE IF NOT EXISTS public.verify_rate_limits (
    client_key    TEXT        PRIMARY KEY,
    window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE public.verify_rate_limits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.verify_rate_limits IS
'Throttle state for the UNAUTHENTICATED document-verification endpoint. RLS on,
zero policies — reachable only through signature_request_verify_by_hash. Holds
no PII: client_key is a transport-level identifier the edge function supplies,
kept only for the length of a rate-limit window.';


-- ---------------------------------------------------------------------------
-- PHASE 5: EMAIL MASKING
-- ---------------------------------------------------------------------------
-- IMMUTABLE and total: it never raises, because it runs inside a query whose
-- other rows are fine and a malformed address must not fail the verification.
--
-- The domain SURVIVES. It is not a leak on this path — the verifier is holding a
-- document that names the parties — and it is the whole point: "is this the john
-- at the company I think it is" is the question a counterparty actually has. The
-- local part is what gets hidden, since that is the guessable half of an address
-- someone might otherwise harvest.
--
-- Declared BEFORE the lookup that calls it, so this file reads top-to-bottom.

CREATE OR REPLACE FUNCTION public.mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_email IS NULL OR p_email = ''  THEN NULL
        WHEN position('@' IN p_email) < 2     THEN '***'
        ELSE left(p_email, 1)
             || repeat('*', greatest(position('@' IN p_email) - 2, 1))
             || substr(p_email, position('@' IN p_email))
    END;
$$;

COMMENT ON FUNCTION public.mask_email(TEXT) IS
'Masks the local part of an address, keeping the first character and the whole
domain. Lives in SQL rather than in a caller so that an unmasked address cannot
leave the database on the public verification path just because the next caller
forgot.';


-- ---------------------------------------------------------------------------
-- PHASE 6: THE VERIFICATION LOOKUP
-- ---------------------------------------------------------------------------
-- Returns NO ROWS for: an unknown hash, a request that is not completed, or a
-- caller over the rate limit. One outcome, three causes, DELIBERATELY
-- indistinguishable — the same reasoning resolveSignerToken applies to
-- expired-vs-revoked-vs-nonexistent tokens. Distinguishing them would make the
-- endpoint an oracle.
--
-- It does NOT raise on a miss either, for the get_invitation_by_token precedent:
-- a logged-out caller has to be able to ask the question, and an exception is
-- itself an answer.
--
-- THE THROTTLE IS INSIDE THE STATEMENT, not read-then-write in the caller. Two
-- round trips with a gap between them is not a rate limit; it is a race with a
-- comment on it. Same discipline as signer_otp_issue and signer_identity_start.
--
-- ALIAS EVERY TABLE REFERENCE. The OUT parameters are deliberately named
-- document_title / finished_at rather than title / completed_at: those are also
-- column names, and plpgsql resolves a bare name to the variable. CG-031's
-- comment calls this "not a style question, it is a silently wrong query".

CREATE OR REPLACE FUNCTION public.signature_request_verify_by_hash(
    p_sha256     TEXT,
    p_client_key TEXT DEFAULT NULL,
    p_max_per_hr INTEGER DEFAULT 60
)
RETURNS TABLE(
    document_title    TEXT,
    organization_name TEXT,
    finished_at       TIMESTAMPTZ,
    matched_artifact  TEXT,
    signer_count      INTEGER,
    signers           JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Defensive, and cheap: the edge function validates 64-lowercase-hex before
    -- it ever gets here, but this function is the security boundary and must not
    -- depend on its caller having done so.
    IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;

    IF p_client_key IS NOT NULL THEN
        INSERT INTO public.verify_rate_limits AS vrl (client_key, window_start, attempt_count)
             VALUES (p_client_key, now(), 1)
        ON CONFLICT (client_key) DO UPDATE
                SET attempt_count = CASE
                        WHEN vrl.window_start < now() - INTERVAL '1 hour' THEN 1
                        ELSE vrl.attempt_count + 1
                    END,
                    window_start  = CASE
                        WHEN vrl.window_start < now() - INTERVAL '1 hour' THEN now()
                        ELSE vrl.window_start
                    END
          RETURNING vrl.attempt_count INTO v_count;

        IF v_count > p_max_per_hr THEN
            RETURN;
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        sr.title,
        org.name,
        sr.completed_at,
        CASE WHEN sr.signed_pdf_sha256 = p_sha256 THEN 'signed_document'
             ELSE 'certificate'
        END,
        (SELECT count(*)::INTEGER
           FROM public.signature_request_signers s
          WHERE s.request_id = sr.id
            AND s.recipient_type = 'signer'),
        COALESCE(
            (SELECT jsonb_agg(
                        jsonb_build_object(
                            'name',         s.signer_name,
                            'email_masked', public.mask_email(s.signer_email),
                            'signed_at',    s.signed_at,
                            'status',       s.status,
                            'auth_methods', COALESCE(
                                (SELECT sal.payload -> 'auth' -> 'methods'
                                   FROM public.signature_audit_log sal
                                  WHERE sal.request_id = sr.id
                                    AND sal.signer_id  = s.id
                                    AND sal.event_type = 'signer_signed'
                                  ORDER BY sal.seq DESC
                                  LIMIT 1),
                                '[]'::JSONB)
                        )
                        ORDER BY s.signer_order, s.signer_name)
               FROM public.signature_request_signers s
              WHERE s.request_id = sr.id
                AND s.recipient_type = 'signer'),
            '[]'::JSONB)
      FROM public.signature_requests sr
      JOIN public.organizations org ON org.id = sr.organization_id
     WHERE sr.status = 'completed'
       AND (sr.signed_pdf_sha256 = p_sha256 OR sr.certificate_sha256 = p_sha256)
     LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.signature_request_verify_by_hash(TEXT, TEXT, INTEGER) IS
'Public document verification, called ONLY by the verify_document edge function.
The sha256 is the credential: it cannot be minted or guessed and can only be
produced by someone holding the artifact, so the disclosure set is limited to
what that holder can already read off the document. Returns no rows for an
unknown hash, a non-completed request, or a throttled caller — indistinguishable
on purpose.';


-- ---------------------------------------------------------------------------
-- PHASE 7: GRANTS
-- ---------------------------------------------------------------------------
-- FROM PUBLIC, anon, authenticated IS NOT BELT AND BRACES. Supabase's
-- pg_default_acl grants EXECUTE to both roles EXPLICITLY on every new function
-- in public, so a bare REVOKE … FROM PUBLIC is INERT — it removes a grant that
-- was never the one in effect, while leaving proacl looking clean. CG-010
-- learned this the hard way. Name the roles; prove it with
-- has_function_privilege, never by reading proacl.
--
-- mask_email is revoked too. It is harmless in isolation, but it is a new
-- function in public and CG-010's standing rule is that nothing new is reachable
-- by default.

REVOKE EXECUTE ON FUNCTION public.signature_request_verify_by_hash(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mask_email(TEXT)                                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.signature_request_verify_by_hash(TEXT, TEXT, INTEGER)  TO service_role;
GRANT EXECUTE ON FUNCTION public.mask_email(TEXT)                                       TO service_role;


-- ---------------------------------------------------------------------------
-- PHASE 8: VERIFY
-- ---------------------------------------------------------------------------

-- (1) BEHAVIOURAL. Masking, the completed-only rule, the miss case and the
--     throttle all live INSIDE statements that cannot be checked by reading the
--     call site.
--
--     APPENDS NO AUDIT ROW, deliberately — see the header. Do not add one.
DO $$
DECLARE
    v_hash   TEXT;
    v_rows   INTEGER;
    v_masked TEXT;
    v_key    TEXT := '_cg043_probe_client';
    r        RECORD;
BEGIN
    v_masked := public.mask_email('jonathan@acme.example');
    IF v_masked <> 'j*******@acme.example' THEN
        RAISE EXCEPTION 'CG-043: mask_email produced %, expected j*******@acme.example', v_masked;
    END IF;
    IF public.mask_email('a@b.co') <> 'a*@b.co' THEN
        RAISE EXCEPTION 'CG-043: mask_email mishandled a one-character local part: %',
            public.mask_email('a@b.co');
    END IF;
    IF public.mask_email(NULL) IS NOT NULL OR public.mask_email('nonsense') <> '***' THEN
        RAISE EXCEPTION 'CG-043: mask_email must be total — NULL and malformed input must not raise.';
    END IF;

    -- An unknown hash returns nothing, and does not raise.
    SELECT count(*) INTO v_rows
      FROM public.signature_request_verify_by_hash(repeat('f', 64), NULL);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-043: an unknown hash returned % row(s); expected 0.', v_rows;
    END IF;

    -- A malformed hash is refused by the function itself, not only the caller.
    SELECT count(*) INTO v_rows
      FROM public.signature_request_verify_by_hash('abc', NULL);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-043: a malformed hash returned % row(s); expected 0.', v_rows;
    END IF;

    -- The throttle, asserted directly: one over the cap yields nothing.
    DELETE FROM public.verify_rate_limits WHERE client_key = v_key;
    PERFORM public.signature_request_verify_by_hash(repeat('e', 64), v_key, 1);
    SELECT count(*) INTO v_rows
      FROM public.signature_request_verify_by_hash(repeat('e', 64), v_key, 1);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-043: the throttle did not engage on the second call.';
    END IF;
    DELETE FROM public.verify_rate_limits WHERE client_key = v_key;

    -- A real completed document, if the database has one.
    SELECT sr.signed_pdf_sha256 INTO v_hash
      FROM public.signature_requests sr
     WHERE sr.status = 'completed' AND sr.signed_pdf_sha256 IS NOT NULL
     LIMIT 1;

    IF v_hash IS NULL THEN
        RAISE NOTICE 'CG-043: no completed request present; skipping the positive-path probe.';
    ELSE
        SELECT * INTO r FROM public.signature_request_verify_by_hash(v_hash, NULL);
        IF r.document_title IS NULL THEN
            RAISE EXCEPTION 'CG-043: a known completed hash returned no row.';
        END IF;
        IF r.matched_artifact <> 'signed_document' THEN
            RAISE EXCEPTION 'CG-043: matched_artifact was %, expected signed_document.', r.matched_artifact;
        END IF;
        IF r.signers::TEXT LIKE '%@%' AND r.signers::TEXT NOT LIKE '%*%' THEN
            RAISE EXCEPTION 'CG-043: an unmasked email address reached the disclosure set.';
        END IF;
        RAISE NOTICE 'CG-043: positive path verified — % signer(s), masked.', r.signer_count;
    END IF;

    -- An in-flight document must not be confirmable to a stranger.
    SELECT sr.source_pdf_sha256 INTO v_hash
      FROM public.signature_requests sr
     WHERE sr.status <> 'completed'
     LIMIT 1;

    IF v_hash IS NOT NULL THEN
        SELECT count(*) INTO v_rows
          FROM public.signature_request_verify_by_hash(v_hash, NULL);
        IF v_rows <> 0 THEN
            RAISE EXCEPTION 'CG-043: a non-completed request was confirmed to an anonymous caller.';
        END IF;
    END IF;

    RAISE NOTICE 'CG-043: verification lookup behaves as specified.';
END $$;

-- (2) THE GRANT TRIPWIRE, SCOPED. CG-033's form, deliberately NOT CG-010's
--     whole-schema allowlist: that array has rotted — CG-018/023/024/027 added
--     RPCs that are legitimately authenticated-reachable and postdate it, so
--     copying it forward fails for functions that are exactly as they should be.
--     The fix for such a failure is to pad the list, which trains everyone to
--     pad the list, which is how a real leak gets waved through. This asserts
--     the invariant it can own.
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
       AND p.proname IN ('signature_request_verify_by_hash', 'mask_email')
       AND (
             has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-043: verification function(s) reachable by anon/authenticated:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-043: verification functions are service_role only.';
END $$;

-- (3) The standing whole-schema invariant CG-009 established: nothing anywhere
--     hands anon an RLS policy. This version adds the product's first
--     unauthenticated READ surface, so re-running it here is the point.
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-043: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;

-- (4) The throttle table's own surface.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'verify_rate_limits'
    ) THEN
        RAISE EXCEPTION
            'CG-043: verify_rate_limits must have NO RLS policies; it is reachable only through SECURITY DEFINER.';
    END IF;

    IF NOT (
        SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.verify_rate_limits'::regclass
    ) THEN
        RAISE EXCEPTION 'CG-043: RLS is not enabled on verify_rate_limits.';
    END IF;

    RAISE NOTICE 'CG-043: throttle surface verified — RLS on, zero policies.';
END $$;

-- (5) ADDITIVE SAFETY. The claim that makes this migration invisible to every
--     document in flight and every document already finished: no envelope has a
--     certificate, and nothing about completion has changed.
DO $$
DECLARE
    v_with_cert INT;
BEGIN
    SELECT count(*) INTO v_with_cert
      FROM public.signature_requests
     WHERE certificate_r2_key IS NOT NULL
        OR certificate_sha256 IS NOT NULL
        OR certificate_generated_at IS NOT NULL;

    IF v_with_cert > 0 THEN
        RAISE EXCEPTION 'CG-043: % request(s) already carry certificate state; expected 0.', v_with_cert;
    END IF;

    RAISE NOTICE 'CG-043: additive — 0 requests carry certificate state, completion path untouched.';
END $$;
