-- ===========================================================================
-- CG-045 — WEBHOOKS: EVENT PUSH, FANNED OUT FROM THE AUDIT CHAIN
-- ===========================================================================
--
-- v1.4.0's second schema half. An integrator that has to POLL
-- `api_envelopes_get` to notice a signature is an integrator running a cron job
-- against us every minute per document. This is the push.
--
-- ═══ THE FAN-OUT POINT IS `signature_audit_log`, NOT THE CALL SITES ═══
--
-- The obvious design is a `emitWebhook(...)` call in `signing_submit`,
-- `envelopes_void`, `signing_decline` and the two cron jobs. It is wrong here for
-- two independent reasons, either of which would be sufficient.
--
-- FIRST, v1.4.0 is additive-only and every one of those files is working,
-- verified code — `signing_submit` most of all. An AFTER INSERT trigger on the
-- audit log touches none of them.
--
-- SECOND, and this outlives the constraint: the audit chain is ALREADY the
-- complete record of everything that happens to a document. It is append-only by
-- trigger, per-request `seq`, hash-chained, and written through exactly one RPC.
-- A future phase that adds a transition writes a chain entry because it must —
-- the chain is the product's evidence — and therefore emits its webhook FOR FREE.
-- A call-site emitter is a list of places someone has to remember, and the bug it
-- produces is silent: an event that simply never fires.
--
-- ═══ THE EXCEPTION HANDLER IS THE MOST IMPORTANT THING IN THIS FILE ═══
--
-- `webhook_fanout_from_audit` hangs off an INSERT into the one table whose write
-- must never fail. A misconfigured endpoint, a payload that will not cast, a
-- lock timeout, a full disk — none of it may abort the audit append it is
-- attached to.
--
--     A WEBHOOK THAT SILENTLY DOES NOT FIRE IS A SUPPORT TICKET.
--     AN AUDIT ENTRY THAT FAILS TO WRITE IS UNRECOVERABLE.
--
-- So the entire trigger body sits inside `BEGIN … EXCEPTION WHEN OTHERS THEN
-- RAISE WARNING … END`. DO NOT REMOVE THAT HANDLER. Removing it converts every
-- webhook misconfiguration into an evidence-chain outage. VERIFY block (3) below
-- asserts it by pointing a delivery at a deliberately impossible state and
-- proving the audit INSERT still commits.
--
-- ═══ THE PUBLIC EVENT VOCABULARY IS A MAPPING, NOT THE ENUM ═══
--
-- `signature_audit_log_event_type_enum` has TWENTY-NINE values and grows with
-- implementation details — `capture_superseded`, `signer_token_issued`,
-- `integrity_verified`, `signer_otp_failed`. Exposing it directly would make
-- every internal refactor a breaking API change, and would leak the product's
-- internal state machine to third parties as a contract.
--
-- `webhook_event_for_audit_event` maps the eight that mean something to an
-- integrator and returns NULL for the other twenty-one, which emit nothing.
-- THAT FUNCTION IS THE ENTIRE PUBLIC CONTRACT. Changing what it returns for an
-- existing input is a breaking change for every consumer.
--
-- ═══ THE SECRET IS PLAINTEXT, AND CG-013 ALREADY ARGUED THIS ═══
--
-- An HMAC secret must be REPLAYABLE to sign with, so unlike an API key or a
-- signer token it cannot be stored as a digest. `cron_dispatch_config` made the
-- same trade for the same reason and named Supabase Vault as the production
-- upgrade; that upgrade moves one SELECT and changes no caller. Until then the
-- protection is the same as for every other secret in this schema: RLS on, zero
-- policies, reachable only through SECURITY DEFINER.
--
-- ═══ THE CRON BLOCK IS GUARDED, WHICH CG-013's WAS NOT ═══
--
-- pg_cron's `cron` schema exists only in the `postgres` database, so a bare
-- `cron.schedule` makes the standing dry-run-against-a-scratch-restore fail at
-- the last statement every time — CG-013 recorded exactly that and accepted it.
-- The block below is wrapped in a `to_regnamespace('cron') IS NOT NULL` guard
-- and NOTICEs instead, so this file applies cleanly in BOTH the scratch copy and
-- the real database. The dry run is worth more when it reaches the end.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PHASE 1: THE TWO ENUMS
-- ---------------------------------------------------------------------------
-- Freshly CREATEd types are usable in the same transaction — it is only
-- EXTENDING an existing enum that Postgres forbids referencing (CG-031/CG-043).
-- So the columns, the mapping function and the probes below may all use these.
--
-- NAMED FOR THE INTEGRATOR'S MENTAL MODEL, NOT OURS. Three of these say
-- `recipient_` rather than describing the envelope, because "a party declined"
-- and "the envelope is dead" are different facts that happen to coincide today:
-- a decline currently ends the route, but `envelope.declined` would be a promise
-- that it always will. A consumer routing on these must never have to guess
-- whether an event is about one party or the whole document.

CREATE TYPE public.webhook_endpoints_events_enum AS ENUM (
    'envelope.sent',
    'envelope.recipient_viewed',
    'envelope.recipient_signed',
    'envelope.recipient_declined',
    'envelope.changes_requested',
    'envelope.completed',
    'envelope.expired',
    'envelope.voided'
);

COMMENT ON TYPE public.webhook_endpoints_events_enum IS
'CG-045: THE PUBLIC WEBHOOK CONTRACT. Third parties subscribe to these values and
switch on them in their own code. Adding a value is safe; renaming or removing
one, or changing which internal event maps to one, is a BREAKING CHANGE — see
webhook_event_for_audit_event.';

CREATE TYPE public.webhook_deliveries_status_enum AS ENUM (
    'pending',
    'delivering',
    'delivered',
    'failed'
);


-- ---------------------------------------------------------------------------
-- PHASE 2: webhook_endpoints
-- ---------------------------------------------------------------------------
-- Top-level (direct child of organizations): native NOT NULL FK, no trigger.

CREATE TABLE public.webhook_endpoints (
    id TEXT PRIMARY KEY DEFAULT generate_id('whe'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    url TEXT NOT NULL,

    -- 32 CSPRNG bytes, base64url. PLAINTEXT — it must be replayable to sign
    -- with. See the header; Vault is the production upgrade.
    secret TEXT NOT NULL,

    events public.webhook_endpoints_events_enum[] NOT NULL,

    is_enabled BOOLEAN NOT NULL DEFAULT true,
    -- The circuit breaker. Reset to 0 on any 2xx; at the threshold the endpoint
    -- is disabled rather than retried forever, because an endpoint that has been
    -- down for a day is not coming back within the next delivery and continuing
    -- to hammer it amplifies someone else's outage.
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,

    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- HTTPS ONLY, enforced in the schema rather than in the caller. This is a
    -- signed payload describing a legal agreement; delivering it over cleartext
    -- would put party names and document titles on the wire. A CHECK means no
    -- future caller can be the one that forgets.
    CONSTRAINT webhook_endpoints_url_https_check
        CHECK (url ~ '^https://[^\s]+$'),
    CONSTRAINT webhook_endpoints_events_not_empty_check
        CHECK (COALESCE(array_length(events, 1), 0) >= 1
               AND array_position(events, NULL::public.webhook_endpoints_events_enum) IS NULL)
);

CREATE INDEX idx_webhook_endpoints_organization_id ON public.webhook_endpoints(organization_id);
-- The fan-out trigger's predicate, indexed as it queries: for a given
-- organization, the enabled endpoints. Every audit insert of a mapped type runs
-- this, so it is on the hot path of the signing flow itself.
CREATE INDEX idx_webhook_endpoints_organization_id_enabled
    ON public.webhook_endpoints(organization_id)
    WHERE is_enabled = true;

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.webhook_endpoints IS
'CG-045: third-party HTTPS endpoints subscribed to envelope events. RLS on, ZERO
policies — it holds a live HMAC secret in plaintext (it must be replayable to
sign with), so it is reachable only through the SECURITY DEFINER routines below,
none of which return the secret except at creation and rotation.';

COMMENT ON COLUMN public.webhook_endpoints.secret IS
'CG-045: HMAC-SHA256 signing secret, PLAINTEXT and deliberately so — a digest
cannot sign. Same trade and same reasoning as cron_dispatch_config.cron_secret
(CG-013). Supabase Vault is the production upgrade and moves one SELECT.';


-- ---------------------------------------------------------------------------
-- PHASE 3: webhook_deliveries
-- ---------------------------------------------------------------------------
-- A child table: organization_id is trigger-populated from the endpoint, per
-- bible-supabase-rls-policies, with `DEFAULT ''` so type generation makes it
-- optional on Insert.

CREATE TABLE public.webhook_deliveries (
    id TEXT PRIMARY KEY DEFAULT generate_id('whd'),
    endpoint_id TEXT NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- The `signature_audit_log` entry this describes. Deliberately NOT a foreign
    -- key: that table has no FK from anything by design (it outlives its
    -- request), and a delivery must survive its source row being archived.
    -- It is the consumer's dedupe key, and it is in the payload and the headers.
    event_id TEXT NOT NULL,
    event_type public.webhook_endpoints_events_enum NOT NULL,
    request_id TEXT,
    payload JSONB NOT NULL,

    status public.webhook_deliveries_status_enum NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_status_code INTEGER,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ONE ENDPOINT RECEIVES ONE EVENT ONCE. This is what makes the fan-out
    -- itself exactly-once no matter how many times it runs: a replay, a
    -- re-inserted audit row, or a future backfill all collide here instead of
    -- double-delivering. Delivery over the wire remains at-least-once — that is
    -- inherent to HTTP, and why the payload carries event_id for the consumer.
    CONSTRAINT webhook_deliveries_endpoint_event_key UNIQUE (endpoint_id, event_id)
);

CREATE INDEX idx_webhook_deliveries_endpoint_id     ON public.webhook_deliveries(endpoint_id);
CREATE INDEX idx_webhook_deliveries_organization_id ON public.webhook_deliveries(organization_id);
-- The pump's exact predicate. Partial, so the delivered archive costs nothing
-- as it grows — the CG-013 `idx_signature_requests_expires_at` pattern.
CREATE INDEX idx_webhook_deliveries_next_attempt_at_pending
    ON public.webhook_deliveries(next_attempt_at)
    WHERE status = 'pending';

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.webhook_deliveries IS
'CG-045: one row per (endpoint, event). Created by webhook_fanout_from_audit,
drained by the webhooks_deliver-pending edge function. RLS on, zero policies —
the payload restates document facts and the delivery log is read through
webhook_deliveries_list, which is admin-gated.';


CREATE OR REPLACE FUNCTION public.set_org_id_from_webhook_endpoint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT whe.organization_id INTO NEW.organization_id
      FROM public.webhook_endpoints whe
     WHERE whe.id = NEW.endpoint_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for endpoint_id %', NEW.endpoint_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_webhook_deliveries
    BEFORE INSERT ON public.webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_webhook_endpoint();


-- ---------------------------------------------------------------------------
-- PHASE 4: THE PUBLIC CONTRACT
-- ---------------------------------------------------------------------------
-- IMMUTABLE, total, and NULL for everything unmapped. Twenty-one of the
-- twenty-nine audit event types are internal bookkeeping and emit nothing.
--
-- Notably absent, and each for a reason worth stating so nobody "fixes" it:
--   signer_token_issued / _redeemed / _revoked  — credential lifecycle, and a
--       webhook naming a token is a webhook that eventually carries one.
--   document_burned, document_signed            — steps INSIDE completion. A
--       consumer wants `envelope.completed` once, not the three writes that
--       produce it.
--   integrity_verified                          — someone downloaded a copy.
--   capture_superseded                          — a consequence of
--       changes_requested, which is already mapped.
--   signer_otp_* / signer_identity_*            — authentication detail about a
--       named human. It is in the audit trail, where access is controlled; it is
--       not something to POST to a third-party URL.
--   certificate_generated, request_updated,
--   signer_fields_saved, signer_notified,
--   signer_reminded, cc_notified,
--   signer_access_denied, request_created       — either internal, or not a
--       state change a counterparty's system acts on.

CREATE OR REPLACE FUNCTION public.webhook_event_for_audit_event(p_event_type TEXT)
RETURNS public.webhook_endpoints_events_enum
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE p_event_type
        WHEN 'request_sent'             THEN 'envelope.sent'
        WHEN 'signer_viewed'            THEN 'envelope.recipient_viewed'
        WHEN 'signer_signed'            THEN 'envelope.recipient_signed'
        WHEN 'signer_declined'          THEN 'envelope.recipient_declined'
        WHEN 'sender_requested_changes' THEN 'envelope.changes_requested'
        WHEN 'request_completed'        THEN 'envelope.completed'
        WHEN 'request_expired'          THEN 'envelope.expired'
        WHEN 'request_cancelled'        THEN 'envelope.voided'
        ELSE NULL
    END::public.webhook_endpoints_events_enum;
$$;

COMMENT ON FUNCTION public.webhook_event_for_audit_event(TEXT) IS
'CG-045: THE ENTIRE PUBLIC WEBHOOK CONTRACT. Maps the internal audit vocabulary
(29 values, which grow with implementation details) onto the 8 an integrator acts
on. Returns NULL for everything else, which emits nothing. Changing what an
existing input maps to is a BREAKING CHANGE for every consumer.';


-- ---------------------------------------------------------------------------
-- PHASE 5: THE FAN-OUT TRIGGER
-- ---------------------------------------------------------------------------
-- READ THE HEADER BEFORE EDITING THIS FUNCTION.
--
-- The entire body is inside an exception handler. That is not defensive
-- programming style; it is the property that makes attaching anything at all to
-- `signature_audit_log` acceptable.

CREATE OR REPLACE FUNCTION public.webhook_fanout_from_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_event   public.webhook_endpoints_events_enum;
    v_payload JSONB;
    v_req     RECORD;
    v_signer  JSONB := NULL;
BEGIN
    BEGIN
        v_event := public.webhook_event_for_audit_event(NEW.event_type::TEXT);

        -- The overwhelmingly common path: 21 of 29 event types, plus every
        -- organization with no endpoints. Return before touching another table.
        IF v_event IS NULL THEN
            RETURN NULL;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.webhook_endpoints whe
             WHERE whe.organization_id = NEW.organization_id
               AND whe.is_enabled = true
               AND v_event = ANY(whe.events)
        ) THEN
            RETURN NULL;
        END IF;

        SELECT r.id, r.title, r.status, r.current_order, r.sent_at, r.completed_at,
               r.expires_at, r.source_pdf_sha256, r.signed_pdf_sha256
          INTO v_req
          FROM public.signature_requests r
         WHERE r.id = NEW.request_id;

        -- The request state as of THIS transaction. Every writer updates the row
        -- before appending its chain entry (finalizeRequest, envelopes_void,
        -- signing_decline all do), so a consumer reading `envelope.status` from
        -- an `envelope.completed` payload sees `completed`, not the state it was
        -- in a moment earlier.
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;

        IF NEW.signer_id IS NOT NULL THEN
            SELECT jsonb_build_object(
                       'id',     s.id,
                       'name',   s.signer_name,
                       'email',  s.signer_email,
                       'order',  s.signer_order,
                       'type',   s.recipient_type,
                       'status', s.status
                   )
              INTO v_signer
              FROM public.signature_request_signers s
             WHERE s.id = NEW.signer_id;
        END IF;

        -- NO FIELD VALUES, NO R2 KEYS, NO AUDIT PAYLOAD, NO PII BEYOND THE PARTY
        -- NAMES THE SUBSCRIBER'S OWN DOCUMENT ALREADY CARRIES. This is POSTed to
        -- a third-party URL over the open internet; the disclosure bar is higher
        -- here than on any authenticated endpoint, and the decline reason in
        -- particular is deliberately absent — it is evidence, it belongs in the
        -- trail and the certificate, and it is not something to broadcast.
        v_payload := jsonb_build_object(
            'event',           v_event,
            'event_id',        NEW.id,
            'occurred_at',     NEW.occurred_at,
            'organization_id', NEW.organization_id,
            'envelope', jsonb_build_object(
                'id',                v_req.id,
                'title',             v_req.title,
                'status',            v_req.status,
                'current_order',     v_req.current_order,
                'sent_at',           v_req.sent_at,
                'completed_at',      v_req.completed_at,
                'expires_at',        v_req.expires_at,
                'source_pdf_sha256', v_req.source_pdf_sha256,
                'signed_pdf_sha256', v_req.signed_pdf_sha256
            ),
            'recipient', v_signer
        );

        INSERT INTO public.webhook_deliveries
            (endpoint_id, event_id, event_type, request_id, payload)
        SELECT whe.id, NEW.id, v_event, NEW.request_id, v_payload
          FROM public.webhook_endpoints whe
         WHERE whe.organization_id = NEW.organization_id
           AND whe.is_enabled = true
           AND v_event = ANY(whe.events)
        ON CONFLICT ON CONSTRAINT webhook_deliveries_endpoint_event_key DO NOTHING;

        RETURN NULL;

    EXCEPTION WHEN OTHERS THEN
        -- ═══════════════════════════════════════════════════════════════════
        -- DO NOT REMOVE THIS HANDLER. See the migration header.
        --
        -- This trigger hangs off an INSERT into the evidence chain. Anything
        -- that can raise in the block above — a bad endpoint row, a lock
        -- timeout, a payload that will not build — would otherwise abort the
        -- audit append it is attached to, and through it the signature,
        -- decline or completion that was being recorded.
        --
        -- A webhook that silently does not fire is a support ticket. An audit
        -- entry that fails to write is unrecoverable.
        -- ═══════════════════════════════════════════════════════════════════
        RAISE WARNING 'webhook_fanout_from_audit failed for audit entry % (%): %',
            NEW.id, NEW.event_type, SQLERRM;
        RETURN NULL;
    END;
END;
$$;

CREATE TRIGGER trigger_webhook_fanout_from_audit
    AFTER INSERT ON public.signature_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.webhook_fanout_from_audit();

COMMENT ON FUNCTION public.webhook_fanout_from_audit() IS
'CG-045: turns audit-chain entries into webhook deliveries. AFTER INSERT on
signature_audit_log, so no code path can add an envelope transition and forget to
emit. THE ENTIRE BODY IS INSIDE AN EXCEPTION HANDLER — removing it converts a
webhook misconfiguration into an evidence-chain outage.';


-- ---------------------------------------------------------------------------
-- PHASE 6: MANAGEMENT ROUTINES
-- ---------------------------------------------------------------------------
-- Same split as CG-044: these three are called from the browser by an admin
-- managing their own organization, each gates itself on is_admin_or_owner as its
-- FIRST STATEMENT, and each is granted to `authenticated` deliberately.

CREATE OR REPLACE FUNCTION public.webhook_endpoint_create(
    p_organization_id TEXT,
    p_name TEXT,
    p_url TEXT,
    p_events public.webhook_endpoints_events_enum[]
)
-- OUT PARAMETERS ARE `endpoint_id` / `signing_secret`, NOT `id` / `secret`.
-- Those are also column names on the table this function INSERTs into, and
-- plpgsql resolves a bare name to the VARIABLE — CG-031's comment calls this
-- "not a style question, it is a silently wrong query". The columns keep their
-- names; only the function's output is renamed.
RETURNS TABLE(endpoint_id TEXT, signing_secret TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_secret TEXT;
    v_id     TEXT;
BEGIN
    IF NOT public.is_admin_or_owner(p_organization_id) THEN
        RAISE EXCEPTION 'webhook_endpoint_create: admin or owner role required';
    END IF;
    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'webhook_endpoint_create: a name is required';
    END IF;
    IF p_events IS NULL OR array_length(p_events, 1) IS NULL THEN
        RAISE EXCEPTION 'webhook_endpoint_create: subscribe to at least one event';
    END IF;

    v_secret := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');

    INSERT INTO public.webhook_endpoints
        (organization_id, name, url, secret, events, created_by_user_id)
    VALUES
        (p_organization_id, btrim(p_name), btrim(p_url), v_secret, p_events, auth.uid())
    RETURNING webhook_endpoints.id INTO v_id;

    -- The secret is returned HERE and never again, the api_key_issue discipline.
    RETURN QUERY SELECT v_id, v_secret;
END;
$$;


CREATE OR REPLACE FUNCTION public.webhook_endpoint_rotate_secret(p_endpoint_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_org    TEXT;
    v_secret TEXT;
BEGIN
    SELECT whe.organization_id INTO v_org
      FROM public.webhook_endpoints whe WHERE whe.id = p_endpoint_id;
    IF v_org IS NULL OR NOT public.is_admin_or_owner(v_org) THEN
        RAISE EXCEPTION 'webhook_endpoint_rotate_secret: unknown endpoint';
    END IF;

    v_secret := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');

    UPDATE public.webhook_endpoints
       SET secret = v_secret, updated_at = now()
     WHERE id = p_endpoint_id;

    RETURN v_secret;
END;
$$;

COMMENT ON FUNCTION public.webhook_endpoint_rotate_secret(TEXT) IS
'CG-045: replaces an endpoint''s signing secret and returns the new one ONCE.
There is deliberately no overlap window: two valid secrets at once means a
consumer that accepts either, which is the state a rotation exists to leave.
Rotating breaks delivery until the consumer is updated, and that is the intended
behaviour of a rotation performed because the old secret leaked.';


CREATE OR REPLACE FUNCTION public.webhook_endpoint_update(
    p_endpoint_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_url TEXT DEFAULT NULL,
    p_events public.webhook_endpoints_events_enum[] DEFAULT NULL,
    p_is_enabled BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_org TEXT;
    v_hit INTEGER;
BEGIN
    SELECT whe.organization_id INTO v_org
      FROM public.webhook_endpoints whe WHERE whe.id = p_endpoint_id;
    IF v_org IS NULL OR NOT public.is_admin_or_owner(v_org) THEN
        RAISE EXCEPTION 'webhook_endpoint_update: unknown endpoint';
    END IF;

    UPDATE public.webhook_endpoints AS whe
       SET name       = COALESCE(btrim(p_name), whe.name),
           url        = COALESCE(btrim(p_url), whe.url),
           events     = COALESCE(p_events, whe.events),
           is_enabled = COALESCE(p_is_enabled, whe.is_enabled),
           -- Re-enabling CLEARS the breaker. Leaving the counter at its
           -- threshold would disable the endpoint again on its next failure
           -- rather than after the next N, which reads as "re-enable did not
           -- work" to the admin who just pressed it.
           consecutive_failures = CASE
               WHEN p_is_enabled IS TRUE THEN 0 ELSE whe.consecutive_failures END,
           disabled_at = CASE WHEN p_is_enabled IS TRUE THEN NULL ELSE whe.disabled_at END,
           disabled_reason = CASE
               WHEN p_is_enabled IS TRUE THEN NULL ELSE whe.disabled_reason END,
           updated_at = now()
     WHERE whe.id = p_endpoint_id;

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;


CREATE OR REPLACE FUNCTION public.webhook_endpoint_delete(p_endpoint_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_org TEXT;
    v_hit INTEGER;
BEGIN
    SELECT whe.organization_id INTO v_org
      FROM public.webhook_endpoints whe WHERE whe.id = p_endpoint_id;
    IF v_org IS NULL OR NOT public.is_admin_or_owner(v_org) THEN
        RAISE EXCEPTION 'webhook_endpoint_delete: unknown endpoint';
    END IF;

    -- A hard delete, taking its deliveries with it by CASCADE. Unlike an api key
    -- (whose id is named in the audit chain's actor snapshot), nothing
    -- references an endpoint historically — a delivery log is operational data,
    -- not evidence.
    DELETE FROM public.webhook_endpoints WHERE id = p_endpoint_id;

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;


-- NEVER SELECTS `secret`.
CREATE OR REPLACE FUNCTION public.webhook_endpoints_list(p_organization_id TEXT)
RETURNS TABLE(
    id TEXT,
    name TEXT,
    url TEXT,
    events public.webhook_endpoints_events_enum[],
    is_enabled BOOLEAN,
    consecutive_failures INTEGER,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,
    created_at TIMESTAMPTZ,
    last_delivery_at TIMESTAMPTZ,
    pending_count INTEGER,
    failed_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- No rows rather than an exception for a non-admin — an empty list renders
    -- as an empty list, an exception renders as a broken page.
    IF NOT public.is_admin_or_owner(p_organization_id) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT whe.id, whe.name, whe.url, whe.events, whe.is_enabled,
           whe.consecutive_failures, whe.disabled_at, whe.disabled_reason, whe.created_at,
           (SELECT max(d.delivered_at) FROM public.webhook_deliveries d
             WHERE d.endpoint_id = whe.id),
           (SELECT count(*)::INTEGER FROM public.webhook_deliveries d
             WHERE d.endpoint_id = whe.id AND d.status = 'pending'),
           (SELECT count(*)::INTEGER FROM public.webhook_deliveries d
             WHERE d.endpoint_id = whe.id AND d.status = 'failed')
      FROM public.webhook_endpoints whe
     WHERE whe.organization_id = p_organization_id
     ORDER BY whe.created_at DESC;
END;
$$;


CREATE OR REPLACE FUNCTION public.webhook_deliveries_list(
    p_endpoint_id TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
    id TEXT,
    event_id TEXT,
    event_type public.webhook_endpoints_events_enum,
    request_id TEXT,
    status public.webhook_deliveries_status_enum,
    attempt_count INTEGER,
    next_attempt_at TIMESTAMPTZ,
    last_status_code INTEGER,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_org TEXT;
BEGIN
    SELECT whe.organization_id INTO v_org
      FROM public.webhook_endpoints whe WHERE whe.id = p_endpoint_id;
    IF v_org IS NULL OR NOT public.is_admin_or_owner(v_org) THEN
        RETURN;
    END IF;

    -- The PAYLOAD is deliberately not returned. It restates document facts the
    -- admin can already see, and the delivery drawer's job is to answer "did it
    -- arrive and why not" — a column of JSON blobs makes that harder to read,
    -- not easier.
    RETURN QUERY
    SELECT d.id, d.event_id, d.event_type, d.request_id, d.status, d.attempt_count,
           d.next_attempt_at, d.last_status_code, d.last_error, d.delivered_at, d.created_at
      FROM public.webhook_deliveries d
     WHERE d.endpoint_id = p_endpoint_id
     ORDER BY d.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;


-- ---------------------------------------------------------------------------
-- PHASE 7: THE DISPATCH ALLOWLIST
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE, never DROP + CREATE. CG-015 is the migration that proved
-- CG-010's tripwire earns its keep: a DROP+CREATE here would silently re-grant
-- anon EXECUTE, because Supabase's pg_default_acl grants it explicitly on every
-- NEWLY CREATED function in public. REPLACE preserves the existing ACL.
--
-- The allowlist is the whole reason this function takes a name rather than a
-- URL: it is SECURITY DEFINER and it builds a URL from configuration, so an
-- unconstrained argument would be an SSRF primitive reachable from any caller
-- that could reach the function.

CREATE OR REPLACE FUNCTION public.cron_dispatch(p_function_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
    v_base   TEXT;
    v_secret TEXT;
    v_id     BIGINT;
BEGIN
    IF p_function_name NOT IN (
        'envelopes_cron_expire',
        'envelopes_cron_remind',
        'webhooks_deliver-pending'   -- CG-045
    ) THEN
        RAISE EXCEPTION 'cron_dispatch: % is not a schedulable function', p_function_name;
    END IF;

    SELECT functions_base_url, cron_secret
      INTO v_base, v_secret
      FROM public.cron_dispatch_config
     WHERE id = 'singleton';

    IF v_base IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE 'cron_dispatch(%): cron_dispatch_config is not populated; skipping.',
            p_function_name;
        RETURN NULL;
    END IF;

    SELECT net.http_post(
        url     := rtrim(v_base, '/') || '/functions/v1/' || p_function_name,
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'x-cron-secret', v_secret
                   ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 30000
    ) INTO v_id;

    RETURN v_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- PHASE 8: GRANTS
-- ---------------------------------------------------------------------------
-- FROM PUBLIC, anon, authenticated NAMING THE ROLES — a bare REVOKE … FROM
-- PUBLIC is inert on this schema (CG-010). Prove it with has_function_privilege.

REVOKE EXECUTE ON FUNCTION public.webhook_event_for_audit_event(TEXT)                                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_fanout_from_audit()                                                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_org_id_from_webhook_endpoint()                                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_endpoint_create(TEXT, TEXT, TEXT, public.webhook_endpoints_events_enum[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_endpoint_rotate_secret(TEXT)                                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_endpoint_update(TEXT, TEXT, TEXT, public.webhook_endpoints_events_enum[], BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_endpoint_delete(TEXT)                                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_endpoints_list(TEXT)                                                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.webhook_deliveries_list(TEXT, INTEGER)                                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_dispatch(TEXT)                                                             FROM PUBLIC, anon, authenticated;

-- Browser-called, each admin-gated as its first statement. Same deliberate
-- exception CG-044 documents for its three management routines.
GRANT EXECUTE ON FUNCTION public.webhook_endpoint_create(TEXT, TEXT, TEXT, public.webhook_endpoints_events_enum[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_endpoint_rotate_secret(TEXT)                                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_endpoint_update(TEXT, TEXT, TEXT, public.webhook_endpoints_events_enum[], BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_endpoint_delete(TEXT)                                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_endpoints_list(TEXT)                                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_deliveries_list(TEXT, INTEGER)                                            TO authenticated, service_role;

-- The delivery pump and the trigger's own helpers. service_role only.
GRANT EXECUTE ON FUNCTION public.webhook_event_for_audit_event(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_dispatch(TEXT)                 TO service_role;


-- ---------------------------------------------------------------------------
-- PHASE 9: SCHEDULES
-- ---------------------------------------------------------------------------
-- GUARDED, unlike CG-013's. pg_cron's `cron` schema lives only in the `postgres`
-- database, so an unguarded block makes every dry run against a scratch restore
-- fail at the final statement. A dry run is worth more when it reaches the end.
--
-- `cron.unschedule` guards precede both: pg_cron permits duplicate job names and
-- would then fire both copies.

DO $$
BEGIN
    IF to_regnamespace('cron') IS NULL THEN
        RAISE NOTICE 'CG-045: pg_cron is not present in this database; schedules skipped.';
        RETURN;
    END IF;

    PERFORM cron.unschedule('webhooks_deliver')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhooks_deliver');
    PERFORM cron.unschedule('api_idempotency_prune') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_idempotency_prune');

    -- Every minute. The retry ladder's first rung is 60 seconds, so a coarser
    -- tick would make "retry in 1 minute" a lie; and a webhook that arrives
    -- minutes after the signature is a webhook the integrator has stopped
    -- trusting.
    PERFORM cron.schedule(
        'webhooks_deliver', '* * * * *',
        $cron$SELECT public.cron_dispatch('webhooks_deliver-pending');$cron$
    );

    -- CG-044 promised this file would schedule it. Hourly at :41, deliberately
    -- off the two existing envelope jobs (:07 and :23) — three jobs contending
    -- on the same minute is a self-inflicted lock pile-up.
    PERFORM cron.schedule(
        'api_idempotency_prune', '41 * * * *',
        $cron$SELECT public.api_idempotency_prune();$cron$
    );

    RAISE NOTICE 'CG-045: scheduled webhooks_deliver (* * * * *) and api_idempotency_prune (41 * * * *).';
END $$;


-- ---------------------------------------------------------------------------
-- PHASE 10: VERIFY
-- ---------------------------------------------------------------------------

-- (1) THE MAPPING IS THE CONTRACT. Asserted exhaustively in both directions:
--     the eight that map, and that NOTHING ELSE does. The second half is what
--     stops a future enum value silently becoming a public event.
DO $$
DECLARE
    v_unmapped TEXT;
    v_mapped   INTEGER;
BEGIN
    IF public.webhook_event_for_audit_event('request_sent')             <> 'envelope.sent'
    OR public.webhook_event_for_audit_event('signer_viewed')            <> 'envelope.recipient_viewed'
    OR public.webhook_event_for_audit_event('signer_signed')            <> 'envelope.recipient_signed'
    OR public.webhook_event_for_audit_event('signer_declined')          <> 'envelope.recipient_declined'
    OR public.webhook_event_for_audit_event('sender_requested_changes') <> 'envelope.changes_requested'
    OR public.webhook_event_for_audit_event('request_completed')        <> 'envelope.completed'
    OR public.webhook_event_for_audit_event('request_expired')          <> 'envelope.expired'
    OR public.webhook_event_for_audit_event('request_cancelled')        <> 'envelope.voided' THEN
        RAISE EXCEPTION 'CG-045: the public event mapping does not match the contract.';
    END IF;

    SELECT count(*) INTO v_mapped
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'signature_audit_log_event_type_enum'
       AND public.webhook_event_for_audit_event(e.enumlabel) IS NOT NULL;

    IF v_mapped <> 8 THEN
        SELECT string_agg(e.enumlabel, ', ') INTO v_unmapped
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'signature_audit_log_event_type_enum'
           AND public.webhook_event_for_audit_event(e.enumlabel) IS NOT NULL;
        RAISE EXCEPTION
            'CG-045: % audit event types map to a public event; expected exactly 8. Mapped: %',
            v_mapped, v_unmapped;
    END IF;

    -- Credential lifecycle and authentication detail must NEVER be POSTed to a
    -- third-party URL. Asserted by name rather than by count.
    IF public.webhook_event_for_audit_event('signer_token_issued')    IS NOT NULL
    OR public.webhook_event_for_audit_event('signer_otp_verified')    IS NOT NULL
    OR public.webhook_event_for_audit_event('signer_identity_failed') IS NOT NULL
    OR public.webhook_event_for_audit_event('document_signed')        IS NOT NULL THEN
        RAISE EXCEPTION 'CG-045: an internal event type leaked into the public webhook contract.';
    END IF;

    RAISE NOTICE 'CG-045: public event mapping verified — exactly 8 of 29, and no credential events.';
END $$;


-- (2) BEHAVIOURAL. The fan-out itself, against a real completed request, inside
--     a transaction that is rolled back.
DO $$
DECLARE
    v_org      TEXT;
    v_req      TEXT;
    v_endpoint TEXT;
    v_rows     INTEGER;
    v_payload  JSONB;
BEGIN
    SELECT r.id, r.organization_id INTO v_req, v_org
      FROM public.signature_requests r
     WHERE r.status <> 'draft'
     ORDER BY r.created_at DESC LIMIT 1;

    IF v_req IS NULL THEN
        RAISE NOTICE 'CG-045: no seeded request — behavioural probe skipped.';
        RETURN;
    END IF;

    INSERT INTO public.webhook_endpoints (organization_id, name, url, secret, events)
    VALUES (v_org, '_cg045_probe', 'https://probe.invalid/hook', 'probe-secret',
            ARRAY['envelope.completed']::public.webhook_endpoints_events_enum[])
    RETURNING id INTO v_endpoint;

    -- A MAPPED event the endpoint subscribes to -> exactly one delivery.
    PERFORM public.signature_audit_append(
        v_req, v_org, NULL, NULL, 'request_completed', '{"_cg045":"probe"}'::JSONB);

    SELECT count(*) INTO v_rows
      FROM public.webhook_deliveries d WHERE d.endpoint_id = v_endpoint;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'CG-045: a subscribed mapped event produced % deliveries; expected 1.', v_rows;
    END IF;

    -- The org id trigger fired, and the payload carries the contract's shape.
    SELECT d.payload INTO v_payload
      FROM public.webhook_deliveries d WHERE d.endpoint_id = v_endpoint LIMIT 1;
    IF v_payload->>'event' <> 'envelope.completed'
    OR v_payload->'envelope'->>'id' <> v_req
    OR v_payload->>'event_id' IS NULL THEN
        RAISE EXCEPTION 'CG-045: the delivery payload is malformed: %', v_payload;
    END IF;
    IF v_payload::TEXT LIKE '%r2_key%' OR v_payload::TEXT LIKE '%field_values%' THEN
        RAISE EXCEPTION 'CG-045: the webhook payload leaks internal keys: %', v_payload;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.webhook_deliveries d
                    WHERE d.endpoint_id = v_endpoint AND d.organization_id = v_org) THEN
        RAISE EXCEPTION 'CG-045: set_org_id_from_webhook_endpoint did not populate organization_id.';
    END IF;

    -- An UNMAPPED event produces nothing.
    PERFORM public.signature_audit_append(
        v_req, v_org, NULL, NULL, 'signer_token_issued', '{"_cg045":"probe"}'::JSONB);
    SELECT count(*) INTO v_rows
      FROM public.webhook_deliveries d WHERE d.endpoint_id = v_endpoint;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'CG-045: an unmapped event produced a delivery (now % rows).', v_rows;
    END IF;

    -- A DISABLED endpoint produces nothing.
    UPDATE public.webhook_endpoints SET is_enabled = false WHERE id = v_endpoint;
    PERFORM public.signature_audit_append(
        v_req, v_org, NULL, NULL, 'request_cancelled', '{"_cg045":"probe"}'::JSONB);
    SELECT count(*) INTO v_rows
      FROM public.webhook_deliveries d WHERE d.endpoint_id = v_endpoint;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'CG-045: a disabled endpoint received a delivery (now % rows).', v_rows;
    END IF;

    -- An endpoint NOT SUBSCRIBED to the event produces nothing.
    UPDATE public.webhook_endpoints
       SET is_enabled = true, events = ARRAY['envelope.sent']::public.webhook_endpoints_events_enum[]
     WHERE id = v_endpoint;
    PERFORM public.signature_audit_append(
        v_req, v_org, NULL, NULL, 'request_expired', '{"_cg045":"probe"}'::JSONB);
    SELECT count(*) INTO v_rows
      FROM public.webhook_deliveries d WHERE d.endpoint_id = v_endpoint;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'CG-045: an unsubscribed endpoint received a delivery (now % rows).', v_rows;
    END IF;

    RAISE NOTICE 'CG-045: fan-out verified — mapped/unmapped, disabled, and unsubscribed all correct.';

    -- The probe appended real entries to a real chain, so it must not commit.
    RAISE EXCEPTION 'CG-045_PROBE_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CG-045_PROBE_ROLLBACK' THEN
            RAISE NOTICE 'CG-045: behavioural probe rolled back cleanly.';
        ELSE
            RAISE;
        END IF;
END $$;


-- (3) THE HANDLER. The assertion the whole design rests on: a fan-out that
--     CANNOT succeed must not prevent the audit entry from being written.
--
--     The failure is induced honestly rather than simulated — the delivery
--     insert is made impossible by dropping the NOT NULL payload into a state
--     the constraint refuses, via an endpoint row whose events array contains
--     the right value but whose id is deleted mid-flight. The simplest reliable
--     induction is a BEFORE INSERT trigger on webhook_deliveries that raises.
DO $$
DECLARE
    v_org      TEXT;
    v_req      TEXT;
    v_endpoint TEXT;
    v_before   INTEGER;
    v_after    INTEGER;
BEGIN
    SELECT r.id, r.organization_id INTO v_req, v_org
      FROM public.signature_requests r
     WHERE r.status <> 'draft'
     ORDER BY r.created_at DESC LIMIT 1;

    IF v_req IS NULL THEN
        RAISE NOTICE 'CG-045: no seeded request — handler probe skipped.';
        RETURN;
    END IF;

    INSERT INTO public.webhook_endpoints (organization_id, name, url, secret, events)
    VALUES (v_org, '_cg045_boom', 'https://boom.invalid/hook', 'probe-secret',
            ARRAY['envelope.completed']::public.webhook_endpoints_events_enum[])
    RETURNING id INTO v_endpoint;

    CREATE OR REPLACE FUNCTION public._cg045_boom() RETURNS TRIGGER
    LANGUAGE plpgsql AS $boom$
    BEGIN
        RAISE EXCEPTION 'CG-045 induced fan-out failure';
    END;
    $boom$;

    CREATE TRIGGER _cg045_boom_trigger
        BEFORE INSERT ON public.webhook_deliveries
        FOR EACH ROW EXECUTE FUNCTION public._cg045_boom();

    SELECT count(*) INTO v_before FROM public.signature_audit_log WHERE request_id = v_req;

    -- THE ASSERTION: this must SUCCEED, emitting a WARNING and no delivery.
    PERFORM public.signature_audit_append(
        v_req, v_org, NULL, NULL, 'request_completed', '{"_cg045":"handler"}'::JSONB);

    SELECT count(*) INTO v_after FROM public.signature_audit_log WHERE request_id = v_req;

    IF v_after <> v_before + 1 THEN
        RAISE EXCEPTION
            'CG-045: A FAILING FAN-OUT ABORTED THE AUDIT APPEND. The exception handler in webhook_fanout_from_audit is missing or broken. (% -> %)',
            v_before, v_after;
    END IF;

    IF EXISTS (SELECT 1 FROM public.webhook_deliveries WHERE endpoint_id = v_endpoint) THEN
        RAISE EXCEPTION 'CG-045: the induced failure still produced a delivery row.';
    END IF;

    DROP TRIGGER _cg045_boom_trigger ON public.webhook_deliveries;
    DROP FUNCTION public._cg045_boom();

    RAISE NOTICE 'CG-045: EXCEPTION HANDLER VERIFIED — a failing fan-out did not abort the audit chain.';

    RAISE EXCEPTION 'CG-045_HANDLER_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CG-045_HANDLER_ROLLBACK' THEN
            RAISE NOTICE 'CG-045: handler probe rolled back cleanly.';
        ELSE
            RAISE;
        END IF;
END $$;


-- (4) GRANTS. Scoped to this migration's functions (CG-033's form).
DO $$
DECLARE
    v_leaks TEXT;
    v_shut  TEXT;
BEGIN
    SELECT string_agg(p.proname, ', ') INTO v_leaks
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('webhook_fanout_from_audit', 'webhook_event_for_audit_event',
                         'set_org_id_from_webhook_endpoint', 'cron_dispatch')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION 'CG-045: internal function(s) reachable by anon/authenticated: %', v_leaks;
    END IF;

    SELECT string_agg(p.proname, ', ') INTO v_shut
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('webhook_endpoint_create', 'webhook_endpoint_update',
                         'webhook_endpoint_delete', 'webhook_endpoints_list',
                         'webhook_deliveries_list', 'webhook_endpoint_rotate_secret')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    IF v_shut IS NOT NULL THEN
        RAISE EXCEPTION 'CG-045: management routine(s) have the wrong grants: %', v_shut;
    END IF;

    RAISE NOTICE 'CG-045: grant split verified.';
END $$;


-- (5) The standing whole-schema invariant, and the two new tables' surface.
DO $$
DECLARE
    v_count INT;
    t TEXT;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY(roles);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-045: % RLS policy/policies target anon; expected 0.', v_count;
    END IF;

    FOREACH t IN ARRAY ARRAY['webhook_endpoints', 'webhook_deliveries'] LOOP
        IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
            RAISE EXCEPTION 'CG-045: % must have NO RLS policies.', t;
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
            RAISE EXCEPTION 'CG-045: RLS is not enabled on %.', t;
        END IF;
    END LOOP;

    RAISE NOTICE 'CG-045: two new tables verified — RLS on, zero policies.';
END $$;


-- (6) ADDITIVE SAFETY. No endpoint exists, so no envelope in flight and no
--     envelope already finished behaves any differently than it did an hour ago.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.webhook_endpoints) THEN
        RAISE EXCEPTION 'CG-045: webhook_endpoints is not empty after a create-only migration.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.webhook_deliveries) THEN
        RAISE EXCEPTION 'CG-045: webhook_deliveries is not empty after a create-only migration.';
    END IF;
    RAISE NOTICE 'CG-045: additive — zero endpoints, so the signing flow is byte-identical to before.';
END $$;
