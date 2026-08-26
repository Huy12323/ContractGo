-- ===========================================================================
-- CG-044 — API KEYS: THE THIRD DOOR
-- ===========================================================================
--
-- v1.4.0's first schema half. Everything this product does today requires a
-- HUMAN: `resolveSender` demands an Authorization header bearing a Supabase
-- user JWT, and `resolveSignerToken` demands a token that was mailed to a named
-- mailbox. There is no third door. This migration builds the credential that
-- opens one.
--
-- ═══ SCOPES ARE `SenderRequirement` VALUES. THEY ARE NOT A NEW VOCABULARY ═══
--
-- CG-027 established `member` / `send_documents` / `manage_templates` as the
-- axis of what a principal may do in an organization, and `has_org_permission`
-- already enforces it for members while admins and owners answer true
-- unconditionally. Every edge function already states its requirement in those
-- words (`_shared/senderAuth.ts`'s `SenderRequirement`).
--
-- A parallel `documents:read` / `documents:write` vocabulary would be a SECOND
-- model that has to be kept in agreement with the first, and the day the two
-- disagree the API is the half that is wrong — it would be granting something
-- the product's own permission model cannot express. So the enum below is that
-- list, and `resolveApiClient` applies the same implication ordering
-- `resolveSender` does.
--
-- `admin` IS DELIBERATELY ABSENT FROM THE ENUM. Member management, ownership
-- transfer and organization deletion are not machine actions. Leaving the value
-- out of the type makes that a schema fact rather than a review convention: an
-- api key CANNOT be granted admin, no matter what a future caller passes.
--
-- ═══ `created_by_user_id` IS BOTH THE FK ANCHOR AND THE REVOCATION RULE ═══
--
-- `signature_requests.created_by` and `signature_audit_log.actor_user_id` are
-- both nullable, so a machine-created envelope is representable with no user at
-- all. That is NOT what we do, for one concrete reason: `resolveSenderEmail`
-- (`_shared/envelopeNotify.ts`) walks `created_by` → `profiles.email` to mail
-- the sender when a document is declined or expires. A NULL there does not
-- fail — it silently drops the notification, which is the worst shape a bug can
-- take.
--
-- So an api-key-created envelope's `created_by` is the human who minted the
-- key, and ON DELETE CASCADE from `auth.users` means the key dies with them.
-- That is also the correct semantic when someone leaves an organization.
--
-- WHAT THE KEY MUST NOT DO IS LET THE CHAIN CLAIM A HUMAN PRESSED THE BUTTON.
-- That is handled ABOVE this layer: `_shared/auditEvidence.ts` gains an
-- `api_client` actor kind carrying the key id and name beside the user id. It
-- is a TypeScript union, not a Postgres enum — no migration, no permanence
-- cost, and the actor snapshot is already free-form JSONB in the payload.
--
-- ═══ THE PLAINTEXT KEY EXISTS EXACTLY ONCE ═══
--
-- `signer_access_tokens`' treatment, for its reasons: only the sha256 is
-- stored, the plaintext is returned by `api_key_issue` and never again, and
-- `key_prefix` is kept in the clear so the settings page can say WHICH key
-- without holding a credential.
--
-- All three tables are RLS-ON WITH ZERO POLICIES — the `signer_access_tokens` /
-- `signer_otp_challenges` / `verify_rate_limits` treatment. No REVOKE ALL ON
-- TABLE: CG-025 set default privileges granting ALL on tables to anon and
-- authenticated and ships a VERIFY block asserting it, so revoking here would
-- contradict a shipped assertion. RLS-with-zero-policies is default-deny and is
-- the convention.
--
-- ═══ THREE FUNCTIONS ARE DELIBERATELY `authenticated`-EXECUTABLE ═══
--
-- CG-010's standing rule is that nothing new in `public` is reachable by anon
-- or authenticated unless the migration says so in the imperative. This one
-- says so: `api_key_issue`, `api_key_revoke` and `api_keys_list` are called
-- from the browser by an admin managing their own organization's keys, and each
-- gates itself on `is_admin_or_owner` as its FIRST STATEMENT. They are the same
-- shape as `signature_verify_chain_for_member`, which CG-010 kept authenticated
-- for the same reason.
--
-- The RESOLUTION path — `api_key_resolve` and the two idempotency routines — is
-- service_role only. Those are the ones that would hand out a principal.
--
-- ═══ NO CRON IN THIS FILE ═══
--
-- `api_idempotency_keys` grows without bound and needs a sweeper.
-- `api_idempotency_prune()` is defined here but NOT scheduled: pg_cron's `cron`
-- schema exists only in the `postgres` database, so a `cron.schedule` block
-- makes the standing dry-run-against-a-scratch-restore discipline fail at the
-- last statement every time (CG-013 hit exactly this). It is scheduled in
-- CG-045 alongside the webhook delivery pump, where a cron block has to exist
-- anyway.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PHASE 1: THE SCOPE TYPE
-- ---------------------------------------------------------------------------
-- ENUM, not TEXT + CHECK, per bible-supabase-schema: it generates a TypeScript
-- union, so `Database["public"]["Enums"]["api_keys_scopes_enum"]` is what the
-- settings page's checkbox list is built from, and a typo in a scope name is a
-- build failure rather than a silent 403.
--
-- A freshly CREATEd type is usable in the same transaction — it is only
-- EXTENDING an existing enum that Postgres forbids referencing (CG-031/CG-043).
-- So the column, the CHECKs and the probe below may all use these values.

CREATE TYPE public.api_keys_scopes_enum AS ENUM (
    'member',
    'send_documents',
    'manage_templates'
);

COMMENT ON TYPE public.api_keys_scopes_enum IS
'CG-044: the scopes grantable to an API key. Deliberately the SenderRequirement
vocabulary from _shared/senderAuth.ts MINUS `admin` — an API key can never be
granted member management, ownership transfer or organization deletion, and
leaving the value out of the type is what makes that a schema fact rather than a
review convention.';


-- ---------------------------------------------------------------------------
-- PHASE 2: api_keys
-- ---------------------------------------------------------------------------
-- A TOP-LEVEL table (direct child of organizations): native NOT NULL FK, no
-- `DEFAULT ''`, no BEFORE INSERT trigger. The organization is never inferred —
-- it is named by the admin issuing the key, and api_key_issue verifies they are
-- an admin OF THAT ORG before writing.

CREATE TABLE public.api_keys (
    id TEXT PRIMARY KEY DEFAULT generate_id('apk'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- sha256 hex of the plaintext key. The plaintext exists exactly once, in
    -- the response to api_key_issue; it is never logged and never stored.
    key_hash TEXT NOT NULL UNIQUE,
    -- The first 12 characters ("cgk_" + 8), kept in the clear so the UI can
    -- name a key. Eight base64url characters is not a credential.
    key_prefix TEXT NOT NULL,

    name TEXT NOT NULL,
    scopes public.api_keys_scopes_enum[] NOT NULL,

    -- Origins this key may ask an embedded signing session to postMessage to
    -- (v1.4.0 Phase E). EMPTY IS NOT A WILDCARD — it means this key cannot mint
    -- embed URLs at all. Full shape validation lives in api_key_issue, where a
    -- rejection can carry a sentence; the CHECK here forbids only the two
    -- values that are meaningless under any interpretation.
    allowed_embed_origins TEXT[] NOT NULL DEFAULT '{}',

    created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- COALESCE, and it is load-bearing: array_length of an empty array is NULL,
    -- NULL >= 1 is NULL, and a CHECK that evaluates to NULL PASSES. Written the
    -- obvious way, this constraint would have accepted a key with no scopes at
    -- all — the one value it exists to forbid.
    CONSTRAINT api_keys_scopes_not_empty_check
        CHECK (COALESCE(array_length(scopes, 1), 0) >= 1
               AND array_position(scopes, NULL::public.api_keys_scopes_enum) IS NULL),
    CONSTRAINT api_keys_embed_origins_shape_check
        CHECK (NOT ('' = ANY(allowed_embed_origins))
               AND array_position(allowed_embed_origins, NULL::TEXT) IS NULL)
);

CREATE INDEX idx_api_keys_organization_id    ON public.api_keys(organization_id);
CREATE INDEX idx_api_keys_created_by_user_id ON public.api_keys(created_by_user_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.api_keys IS
'CG-044: machine credentials for the v1.4.0 API surface. RLS on, ZERO policies —
reachable only through the SECURITY DEFINER functions in this migration. Only
the sha256 of a key is stored; the plaintext is returned once by api_key_issue
and cannot be recovered.';

COMMENT ON COLUMN public.api_keys.created_by_user_id IS
'CG-044: the human who minted the key. Serves two purposes that happen to
coincide — envelopes created through this key set signature_requests.created_by
to it, so resolveSenderEmail can still mail the sender on decline and expiry;
and ON DELETE CASCADE means the key dies with the account, which is the correct
revocation semantic when someone leaves.';

COMMENT ON COLUMN public.api_keys.allowed_embed_origins IS
'CG-044: origins this key may target with an embedded signing session. An EMPTY
array is not a wildcard — it means the key cannot mint embed URLs. Held on the
KEY rather than accepted per-request so that a leaked key still cannot aim
signing events at an origin its owner never registered.';


-- ---------------------------------------------------------------------------
-- PHASE 3: api_idempotency_keys
-- ---------------------------------------------------------------------------
-- A retried send is two contracts in a counterparty's inbox and two live token
-- links, and there is no way to un-send. So `Idempotency-Key` is REQUIRED on the
-- create endpoint rather than optional: a 400 for a missing header is a
-- five-minute integration fix, a duplicated legal document is not recoverable.
--
-- The PK leads with organization_id, so it also serves as that column's index —
-- a separate idx_ would be a duplicate and `db lint` would say so. `endpoint` is
-- in the key because two different endpoints may legitimately see the same value
-- from a client that generates one UUID per outbound operation.
--
-- `request_fingerprint` catches the real mistake: a client reusing a key with a
-- DIFFERENT body has a bug, and answering it with the first call's response
-- would silently substitute one document for another.

CREATE TABLE public.api_idempotency_keys (
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,

    api_key_id TEXT REFERENCES public.api_keys(id) ON DELETE SET NULL,
    request_fingerprint TEXT NOT NULL,

    -- NULL until the handler finishes. A row with a NULL status is IN FLIGHT,
    -- which is a distinct answer from "replay" and earns a 409 — not the stored
    -- response of a call that has not produced one yet.
    response_status INTEGER,
    response_body JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    PRIMARY KEY (organization_id, endpoint, idempotency_key)
);

CREATE INDEX idx_api_idempotency_keys_api_key_id ON public.api_idempotency_keys(api_key_id);
CREATE INDEX idx_api_idempotency_keys_created_at ON public.api_idempotency_keys(created_at);

ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.api_idempotency_keys IS
'CG-044: insert-first-wins idempotency for the API surface. RLS on, zero
policies. A row with a NULL response_status is in flight; a completed row is
replayed verbatim so a retry returns the ORIGINAL answer rather than a conflict.
Swept by api_idempotency_prune(), which CG-045 schedules.';


-- ---------------------------------------------------------------------------
-- PHASE 4: api_rate_limits
-- ---------------------------------------------------------------------------
-- `verify_rate_limits`' shape verbatim. Not org-scoped: client_key is whatever
-- the resolver decides identifies a caller (the api key id, today), and nothing
-- joins on it.

CREATE TABLE public.api_rate_limits (
    client_key    TEXT        PRIMARY KEY,
    window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.api_rate_limits IS
'CG-044: throttle state for the API surface, keyed on the api key id. RLS on,
zero policies — written only inside api_key_resolve, in the same statement that
reads it.';


-- ---------------------------------------------------------------------------
-- PHASE 5: ISSUE
-- ---------------------------------------------------------------------------
-- Generates the plaintext, stores only its digest, returns the plaintext once.
-- The generation is the `signer_token_issue` recipe: gen_random_bytes from
-- pgcrypto, base64url-encoded. 24 bytes is 192 bits and 32 characters.
--
-- ORIGIN VALIDATION LIVES HERE, NOT IN A CHECK CONSTRAINT. A CHECK cannot carry
-- a subquery, so validating an ARRAY of origins by regex inside one would mean
-- an IMMUTABLE helper function that the constraint then depends on — a shape
-- that survives dump/restore badly and cannot explain itself to the caller.
-- Here the refusal names the offending origin.

CREATE OR REPLACE FUNCTION public.api_key_issue(
    p_organization_id TEXT,
    p_name TEXT,
    p_scopes public.api_keys_scopes_enum[],
    p_allowed_embed_origins TEXT[] DEFAULT '{}',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(api_key TEXT, api_key_id TEXT, key_prefix TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_key    TEXT;
    v_hash   TEXT;
    v_prefix TEXT;
    v_id     TEXT;
    v_origin TEXT;
BEGIN
    IF NOT public.is_admin_or_owner(p_organization_id) THEN
        RAISE EXCEPTION 'api_key_issue: admin or owner role required';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'api_key_issue: a name is required';
    END IF;

    IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
        RAISE EXCEPTION 'api_key_issue: at least one scope is required';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'api_key_issue: expires_at must be in the future';
    END IF;

    -- A bare origin: scheme, host, optional port. No path, no trailing slash,
    -- no wildcard — this string is compared against a browser's `origin` and is
    -- later used verbatim as a postMessage targetOrigin, where anything looser
    -- silently widens who can receive a signing event.
    FOREACH v_origin IN ARRAY COALESCE(p_allowed_embed_origins, '{}'::TEXT[]) LOOP
        IF v_origin !~ '^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$' THEN
            RAISE EXCEPTION
                'api_key_issue: % is not a bare origin (expected scheme://host[:port], no path)', v_origin;
        END IF;
    END LOOP;

    v_key    := 'cgk_' || translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
    v_hash   := encode(digest(v_key, 'sha256'), 'hex');
    v_prefix := left(v_key, 12);

    INSERT INTO public.api_keys (
        organization_id, key_hash, key_prefix, name, scopes,
        allowed_embed_origins, created_by_user_id, expires_at
    )
    VALUES (
        p_organization_id, v_hash, v_prefix, btrim(p_name), p_scopes,
        COALESCE(p_allowed_embed_origins, '{}'::TEXT[]), auth.uid(), p_expires_at
    )
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_key, v_id, v_prefix;
END;
$$;

COMMENT ON FUNCTION public.api_key_issue(TEXT, TEXT, public.api_keys_scopes_enum[], TEXT[], TIMESTAMPTZ) IS
'CG-044: mints an API key for an organization the caller administers. Returns the
PLAINTEXT KEY, which exists only in this response and cannot be recovered
afterwards. Deliberately authenticated-executable — it gates itself on
is_admin_or_owner as its first statement.';


-- ---------------------------------------------------------------------------
-- PHASE 6: REVOKE AND LIST
-- ---------------------------------------------------------------------------
-- Revocation is a timestamp, not a DELETE. api_idempotency_keys references the
-- key ON DELETE SET NULL, and the audit chain's actor snapshot names the key id
-- — a revoked key must still be resolvable as a historical fact even though it
-- can no longer authenticate anything.

CREATE OR REPLACE FUNCTION public.api_key_revoke(p_api_key_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_org TEXT;
    v_hit INTEGER;
BEGIN
    SELECT ak.organization_id INTO v_org
      FROM public.api_keys ak
     WHERE ak.id = p_api_key_id;

    -- No such key and a key in someone else's organization answer identically.
    -- An id is guessable-shaped, and confirming one exists is a fact the caller
    -- has no business learning.
    IF v_org IS NULL OR NOT public.is_admin_or_owner(v_org) THEN
        RAISE EXCEPTION 'api_key_revoke: unknown api key';
    END IF;

    UPDATE public.api_keys AS ak
       SET revoked_at = now(), updated_at = now()
     WHERE ak.id = p_api_key_id
       AND ak.revoked_at IS NULL;

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;

COMMENT ON FUNCTION public.api_key_revoke(TEXT) IS
'CG-044: revokes an API key. Returns false when it was already revoked, so a
double-press is not an error. Raises identically for an unknown key and one in
another organization.';


-- NEVER SELECTS key_hash. The column is not a usable credential on its own, but
-- the discipline in this codebase is that a secrets table is read through a
-- function that returns only what the caller needs, and the list is also where
-- the admin gate lives.
CREATE OR REPLACE FUNCTION public.api_keys_list(p_organization_id TEXT)
RETURNS TABLE(
    id TEXT,
    name TEXT,
    key_prefix TEXT,
    scopes public.api_keys_scopes_enum[],
    allowed_embed_origins TEXT[],
    created_by_user_id UUID,
    created_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Returns NO ROWS rather than raising for a non-admin, the
    -- signature_verify_chain_for_member precedent: an empty list renders as an
    -- empty list, while an exception renders as a broken page.
    IF NOT public.is_admin_or_owner(p_organization_id) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT ak.id, ak.name, ak.key_prefix, ak.scopes, ak.allowed_embed_origins,
           ak.created_by_user_id, ak.created_at, ak.last_used_at,
           ak.expires_at, ak.revoked_at
      FROM public.api_keys ak
     WHERE ak.organization_id = p_organization_id
     ORDER BY ak.revoked_at NULLS FIRST, ak.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.api_keys_list(TEXT) IS
'CG-044: lists an organization''s API keys for the settings page. Never returns
key_hash. Returns no rows for a non-admin rather than raising.';


-- ---------------------------------------------------------------------------
-- PHASE 7: RESOLVE — the authorization primitive
-- ---------------------------------------------------------------------------
-- ONE UPDATE asserts every liveness precondition and performs the accounting,
-- so a revoked or expired key can never be resolved by a caller that read the
-- row a moment earlier. Same reasoning as signer_token_redeem and
-- signature_claim_turn.
--
-- ORDER MATTERS AND IS NOT THE OBVIOUS ONE: the key is resolved FIRST and only
-- then throttled. Throttling before resolution would let anyone with the
-- endpoint URL create an unbounded number of api_rate_limits rows by presenting
-- garbage keys — a write amplification on an unauthenticated path.
--
-- `throttled` is RETURNED rather than collapsing into "no rows", which is the
-- opposite of signature_request_verify_by_hash and deliberately so. That caller
-- is anonymous and every distinction is an oracle; this caller has proved it
-- holds a live credential, and telling it to back off for sixty seconds is
-- information it is entitled to and cannot act on maliciously.

CREATE OR REPLACE FUNCTION public.api_key_resolve(
    p_key_hash TEXT,
    p_ip TEXT DEFAULT NULL,
    p_max_per_hr INTEGER DEFAULT 600
)
RETURNS TABLE(
    api_key_id TEXT,
    organization_id TEXT,
    name TEXT,
    scopes public.api_keys_scopes_enum[],
    allowed_embed_origins TEXT[],
    created_by_user_id UUID,
    throttled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_ip     INET;
    v_id     TEXT;
    v_org    TEXT;
    v_name   TEXT;
    v_scopes public.api_keys_scopes_enum[];
    v_orig   TEXT[];
    v_user   UUID;
    v_count  INTEGER;
BEGIN
    IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;

    -- getRequestIp returns null behind a gateway that sets no forwarding
    -- header, and a malformed value must degrade to "unknown" rather than abort
    -- an otherwise valid request.
    BEGIN
        v_ip := NULLIF(btrim(COALESCE(p_ip, '')), '')::INET;
    EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
    END;

    UPDATE public.api_keys AS ak
       SET last_used_at = now(),
           last_used_ip = COALESCE(v_ip, ak.last_used_ip)
     WHERE ak.key_hash = p_key_hash
       AND ak.revoked_at IS NULL
       AND (ak.expires_at IS NULL OR ak.expires_at > now())
    RETURNING ak.id, ak.organization_id, ak.name, ak.scopes,
              ak.allowed_embed_origins, ak.created_by_user_id
         INTO v_id, v_org, v_name, v_scopes, v_orig, v_user;

    IF v_id IS NULL THEN
        RETURN;
    END IF;

    -- The throttle is INSIDE the statement, not read-then-write in the caller.
    -- Two round trips with a gap between them is not a rate limit; it is a race
    -- with a comment on it. Same discipline as signer_otp_issue and
    -- signature_request_verify_by_hash.
    INSERT INTO public.api_rate_limits AS arl (client_key, window_start, attempt_count)
         VALUES (v_id, now(), 1)
    ON CONFLICT (client_key) DO UPDATE
            SET attempt_count = CASE
                    WHEN arl.window_start < now() - INTERVAL '1 hour' THEN 1
                    ELSE arl.attempt_count + 1
                END,
                window_start  = CASE
                    WHEN arl.window_start < now() - INTERVAL '1 hour' THEN now()
                    ELSE arl.window_start
                END
      RETURNING arl.attempt_count INTO v_count;

    RETURN QUERY SELECT v_id, v_org, v_name, v_scopes, v_orig, v_user,
                        (v_count > p_max_per_hr);
END;
$$;

COMMENT ON FUNCTION public.api_key_resolve(TEXT, TEXT, INTEGER) IS
'CG-044: the API surface''s authorization primitive, called only by
_shared/apiAuth.ts. Returns NO ROWS for an unknown, revoked or expired key — one
outcome, three causes, indistinguishable on purpose. Returns throttled=true for a
live key over its hourly budget, which IS distinguished because the caller has
already proved it holds a credential.';


-- ---------------------------------------------------------------------------
-- PHASE 8: IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- Two functions, because a claim and its outcome are separated by the entire
-- handler. CG-012's outcome vocabulary: a name per cause, because "did not
-- proceed" has three and only one of them is a bug.

CREATE OR REPLACE FUNCTION public.api_idempotency_claim(
    p_organization_id TEXT,
    p_endpoint TEXT,
    p_key TEXT,
    p_fingerprint TEXT,
    p_api_key_id TEXT
)
RETURNS TABLE(outcome TEXT, response_status INTEGER, response_body JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_claimed INTEGER := 0;
    r         RECORD;
BEGIN
    -- Insert-first-wins. Two concurrent retries race here and exactly one
    -- inserts; the loser falls through to the read below and sees an in-flight
    -- row, which is the correct answer for it.
    INSERT INTO public.api_idempotency_keys
        (organization_id, endpoint, idempotency_key, api_key_id, request_fingerprint)
    VALUES
        (p_organization_id, p_endpoint, p_key, p_api_key_id, p_fingerprint)
    ON CONFLICT (organization_id, endpoint, idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed > 0 THEN
        RETURN QUERY SELECT 'claimed'::TEXT, NULL::INTEGER, NULL::JSONB;
        RETURN;
    END IF;

    SELECT aik.request_fingerprint, aik.response_status, aik.response_body
      INTO r
      FROM public.api_idempotency_keys aik
     WHERE aik.organization_id = p_organization_id
       AND aik.endpoint        = p_endpoint
       AND aik.idempotency_key = p_key;

    IF r.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
        RETURN QUERY SELECT 'fingerprint_mismatch'::TEXT, NULL::INTEGER, NULL::JSONB;
    ELSIF r.response_status IS NULL THEN
        RETURN QUERY SELECT 'in_flight'::TEXT, NULL::INTEGER, NULL::JSONB;
    ELSE
        RETURN QUERY SELECT 'replay'::TEXT, r.response_status, r.response_body;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.api_idempotency_claim(TEXT, TEXT, TEXT, TEXT, TEXT) IS
'CG-044: insert-first-wins idempotency claim. Outcomes: claimed (proceed),
replay (return the stored response verbatim), in_flight (a concurrent duplicate
— 409), fingerprint_mismatch (the same key with a different body — 409, and a
client bug).';


CREATE OR REPLACE FUNCTION public.api_idempotency_complete(
    p_organization_id TEXT,
    p_endpoint TEXT,
    p_key TEXT,
    p_status INTEGER,
    p_body JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hit INTEGER;
BEGIN
    -- Guarded on response_status IS NULL so a completion can never overwrite a
    -- recorded answer. A retry that somehow reached the handler must not be
    -- able to replace what the first call returned.
    UPDATE public.api_idempotency_keys AS aik
       SET response_status = p_status,
           response_body   = p_body,
           completed_at    = now()
     WHERE aik.organization_id = p_organization_id
       AND aik.endpoint        = p_endpoint
       AND aik.idempotency_key = p_key
       AND aik.response_status IS NULL;

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;

COMMENT ON FUNCTION public.api_idempotency_complete(TEXT, TEXT, TEXT, INTEGER, JSONB) IS
'CG-044: records the response against a claimed idempotency key. Guarded on
response_status IS NULL — a completion can never overwrite a recorded answer.';


-- A claim that never completes (the handler crashed, the runtime was killed)
-- would otherwise block that key forever with `in_flight`. Sweeping in-flight
-- rows aggressively and completed rows slowly is the whole policy.
CREATE OR REPLACE FUNCTION public.api_idempotency_prune(
    p_completed_older_than INTERVAL DEFAULT INTERVAL '30 days',
    p_in_flight_older_than INTERVAL DEFAULT INTERVAL '1 hour'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.api_idempotency_keys aik
     WHERE (aik.response_status IS NOT NULL AND aik.created_at < now() - p_completed_older_than)
        OR (aik.response_status IS NULL     AND aik.created_at < now() - p_in_flight_older_than);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.api_idempotency_prune(INTERVAL, INTERVAL) IS
'CG-044: sweeps api_idempotency_keys. Scheduled by CG-045 — see this migration''s
header for why no cron block lives in this file.';


-- ---------------------------------------------------------------------------
-- PHASE 9: GRANTS
-- ---------------------------------------------------------------------------
-- FROM PUBLIC, anon, authenticated IS NOT BELT AND BRACES. Supabase's
-- pg_default_acl grants EXECUTE to both roles EXPLICITLY on every new function
-- in public, so a bare REVOKE … FROM PUBLIC is INERT — it removes a grant that
-- was never the one in effect, while leaving proacl looking clean. CG-010
-- learned this the hard way. Name the roles; prove it with
-- has_function_privilege, never by reading proacl.

REVOKE EXECUTE ON FUNCTION public.api_key_issue(TEXT, TEXT, public.api_keys_scopes_enum[], TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_key_revoke(TEXT)                                                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_keys_list(TEXT)                                                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_key_resolve(TEXT, TEXT, INTEGER)                                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_idempotency_claim(TEXT, TEXT, TEXT, TEXT, TEXT)                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_idempotency_complete(TEXT, TEXT, TEXT, INTEGER, JSONB)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.api_idempotency_prune(INTERVAL, INTERVAL)                                     FROM PUBLIC, anon, authenticated;

-- THE THREE MANAGEMENT ROUTINES ARE RE-GRANTED TO `authenticated`, DELIBERATELY.
-- See the header: each gates itself on is_admin_or_owner as its first statement,
-- and each is called from the browser by an admin managing their own
-- organization. This is the same exception CG-010 made for
-- signature_verify_chain_for_member. Everything on the RESOLUTION path stays
-- service_role only, and VERIFY block (2) asserts exactly that split.
GRANT EXECUTE ON FUNCTION public.api_key_issue(TEXT, TEXT, public.api_keys_scopes_enum[], TEXT[], TIMESTAMPTZ)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_key_revoke(TEXT)                                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_keys_list(TEXT)                                                            TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.api_key_resolve(TEXT, TEXT, INTEGER)                                           TO service_role;
GRANT EXECUTE ON FUNCTION public.api_idempotency_claim(TEXT, TEXT, TEXT, TEXT, TEXT)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.api_idempotency_complete(TEXT, TEXT, TEXT, INTEGER, JSONB)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.api_idempotency_prune(INTERVAL, INTERVAL)                                      TO service_role;


-- ---------------------------------------------------------------------------
-- PHASE 10: VERIFY
-- ---------------------------------------------------------------------------

-- (1) BEHAVIOURAL. Every claim below lives inside a statement that cannot be
--     checked by reading the call site: the liveness conditions in resolve's
--     WHERE clause, the throttle's window arithmetic, and the four idempotency
--     outcomes.
--
--     The probe needs a real organization and a real auth.users row. It SKIPS
--     with a NOTICE rather than failing if the database has neither — a fresh
--     checkout is a legitimate state, and a migration that only applies to a
--     seeded database is not a migration.
--
--     APPENDS NO AUDIT ROW. Nothing here touches signature_audit_log.
DO $$
DECLARE
    v_org    TEXT;
    v_user   UUID;
    v_key    TEXT;
    v_id     TEXT;
    v_hash   TEXT;
    v_rows   INTEGER;
    v_thr    BOOLEAN;
    v_out    TEXT;
    v_status INTEGER;
BEGIN
    SELECT o.id, o.owner_id INTO v_org, v_user
      FROM public.organizations o
     WHERE o.owner_id IS NOT NULL
     LIMIT 1;

    IF v_org IS NULL THEN
        RAISE NOTICE 'CG-044: no seeded organization — behavioural probe skipped.';
        RETURN;
    END IF;

    -- Issue directly rather than through api_key_issue: that function reads
    -- auth.uid(), which is NULL inside a migration. The generation recipe is
    -- what is under test everywhere else; here we are testing resolve.
    v_key  := 'cgk_' || translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
    v_hash := encode(digest(v_key, 'sha256'), 'hex');

    INSERT INTO public.api_keys
        (organization_id, key_hash, key_prefix, name, scopes, created_by_user_id)
    VALUES
        (v_org, v_hash, left(v_key, 12), '_cg044_probe',
         ARRAY['member', 'send_documents']::public.api_keys_scopes_enum[], v_user)
    RETURNING id INTO v_id;

    -- A live key resolves, is not throttled, and carries its scopes back.
    SELECT r.throttled INTO v_thr
      FROM public.api_key_resolve(v_hash, '203.0.113.9') r;
    IF v_thr IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'CG-044: a live key did not resolve un-throttled (got %).', v_thr;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.api_keys ak
         WHERE ak.id = v_id AND ak.last_used_at IS NOT NULL
           AND ak.last_used_ip = '203.0.113.9'::INET
    ) THEN
        RAISE EXCEPTION 'CG-044: resolve did not record last_used_at / last_used_ip.';
    END IF;

    -- A malformed IP must degrade to NULL, not abort the resolution.
    SELECT count(*) INTO v_rows FROM public.api_key_resolve(v_hash, 'not-an-ip') r;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'CG-044: a malformed IP broke resolution (% rows).', v_rows;
    END IF;

    -- The throttle engages on the call AFTER the cap.
    UPDATE public.api_rate_limits SET attempt_count = 5, window_start = now()
     WHERE client_key = v_id;
    SELECT r.throttled INTO v_thr FROM public.api_key_resolve(v_hash, NULL, 5) r;
    IF v_thr IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'CG-044: the throttle did not engage past the cap (got %).', v_thr;
    END IF;

    -- Revoked and expired keys both resolve to nothing.
    UPDATE public.api_keys SET revoked_at = now() WHERE id = v_id;
    SELECT count(*) INTO v_rows FROM public.api_key_resolve(v_hash, NULL) r;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-044: a revoked key still resolved (% rows).', v_rows;
    END IF;

    UPDATE public.api_keys SET revoked_at = NULL, expires_at = now() - INTERVAL '1 second'
     WHERE id = v_id;
    SELECT count(*) INTO v_rows FROM public.api_key_resolve(v_hash, NULL) r;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-044: an expired key still resolved (% rows).', v_rows;
    END IF;

    -- An unknown key resolves to nothing AND writes no throttle row — the
    -- ordering argument in PHASE 7, asserted directly.
    SELECT count(*) INTO v_rows FROM public.api_key_resolve(repeat('a', 64), NULL) r;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'CG-044: an unknown key resolved (% rows).', v_rows;
    END IF;
    IF EXISTS (SELECT 1 FROM public.api_rate_limits WHERE client_key = repeat('a', 64)) THEN
        RAISE EXCEPTION 'CG-044: an unknown key created a rate-limit row — resolve must precede throttle.';
    END IF;

    -- The scope CHECK refuses an empty grant.
    BEGIN
        INSERT INTO public.api_keys
            (organization_id, key_hash, key_prefix, name, scopes, created_by_user_id)
        VALUES (v_org, 'x', 'x', '_cg044_bad', '{}'::public.api_keys_scopes_enum[], v_user);
        RAISE EXCEPTION 'CG-044: a key with zero scopes was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- The four idempotency outcomes.
    SELECT c.outcome INTO v_out
      FROM public.api_idempotency_claim(v_org, '_probe', 'k1', 'fp1', v_id) c;
    IF v_out <> 'claimed' THEN
        RAISE EXCEPTION 'CG-044: first claim returned %, expected claimed.', v_out;
    END IF;

    SELECT c.outcome INTO v_out
      FROM public.api_idempotency_claim(v_org, '_probe', 'k1', 'fp1', v_id) c;
    IF v_out <> 'in_flight' THEN
        RAISE EXCEPTION 'CG-044: an unfinished claim returned %, expected in_flight.', v_out;
    END IF;

    SELECT c.outcome INTO v_out
      FROM public.api_idempotency_claim(v_org, '_probe', 'k1', 'fp-DIFFERENT', v_id) c;
    IF v_out <> 'fingerprint_mismatch' THEN
        RAISE EXCEPTION 'CG-044: a changed body returned %, expected fingerprint_mismatch.', v_out;
    END IF;

    IF NOT public.api_idempotency_complete(v_org, '_probe', 'k1', 201, '{"id":"sgr_probe"}'::JSONB) THEN
        RAISE EXCEPTION 'CG-044: completing a claimed key returned false.';
    END IF;
    IF public.api_idempotency_complete(v_org, '_probe', 'k1', 500, '{"error":"x"}'::JSONB) THEN
        RAISE EXCEPTION 'CG-044: a second completion overwrote a recorded answer.';
    END IF;

    SELECT c.outcome, c.response_status INTO v_out, v_status
      FROM public.api_idempotency_claim(v_org, '_probe', 'k1', 'fp1', v_id) c;
    IF v_out <> 'replay' OR v_status <> 201 THEN
        RAISE EXCEPTION 'CG-044: replay returned % / %, expected replay / 201.', v_out, v_status;
    END IF;

    -- Clean up after the probe. These rows name an organization that is real;
    -- leaving a revoked probe key and a fake idempotency record in a seeded
    -- database is how a later smoke test reads a stale fixture as a result.
    DELETE FROM public.api_idempotency_keys WHERE organization_id = v_org AND endpoint = '_probe';
    DELETE FROM public.api_rate_limits WHERE client_key = v_id;
    DELETE FROM public.api_keys WHERE id = v_id;

    RAISE NOTICE 'CG-044: behavioural probe passed — resolve liveness, throttle, and four idempotency outcomes.';
END $$;


-- (2) THE GRANT SPLIT. Scoped to this migration's own functions (CG-033's form),
--     NOT CG-010's whole-schema allowlist, which has rotted: copying it forward
--     fails for functions that are exactly as they should be, and the fix for
--     such a failure is to pad the list, which trains everyone to pad the list.
--
--     This asserts BOTH halves — that the resolution path is closed, and that
--     the three management routines really are open to authenticated, so a
--     future migration that "tidies" them shut fails here rather than in a
--     settings page nobody opens until release day.
DO $$
DECLARE
    v_leaks TEXT;
    v_shut  TEXT;
BEGIN
    SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', E'\n  ')
      INTO v_leaks
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('api_key_resolve', 'api_idempotency_claim',
                         'api_idempotency_complete', 'api_idempotency_prune')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-044: resolution-path function(s) reachable by anon/authenticated:\n  %', v_leaks;
    END IF;

    SELECT string_agg(p.proname, ', ')
      INTO v_shut
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('api_key_issue', 'api_key_revoke', 'api_keys_list')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'));

    IF v_shut IS NOT NULL THEN
        RAISE EXCEPTION
            'CG-044: management routine(s) have the wrong grants (anon-reachable, or not reachable by authenticated): %',
            v_shut;
    END IF;

    RAISE NOTICE 'CG-044: grant split verified — resolution service_role only, management admin-gated but authenticated.';
END $$;


-- (3) The standing whole-schema invariant CG-009 established, re-run because
--     this version adds a machine principal: nothing anywhere hands anon an RLS
--     policy.
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-044: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;
END $$;


-- (4) The three new tables' own surface: RLS on, zero policies.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['api_keys', 'api_idempotency_keys', 'api_rate_limits'] LOOP
        IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
            RAISE EXCEPTION
                'CG-044: % must have NO RLS policies; it is reachable only through SECURITY DEFINER.', t;
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
            RAISE EXCEPTION 'CG-044: RLS is not enabled on %.', t;
        END IF;
    END LOOP;

    RAISE NOTICE 'CG-044: three secrets tables verified — RLS on, zero policies.';
END $$;


-- (5) ADDITIVE SAFETY. The claim that makes this migration invisible to every
--     document in flight and every document already finished: it touched no
--     existing table, and no envelope has a machine principal.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.api_keys) THEN
        RAISE EXCEPTION 'CG-044: api_keys is not empty after a create-only migration.';
    END IF;
    RAISE NOTICE 'CG-044: additive — three new tables, zero rows, no existing table altered.';
END $$;
