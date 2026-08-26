-- ============================================
-- CG-013 — Reminders & expiry (v1.1.0 Phase E)
-- ============================================
--
-- Two ways a route ends or moves that nobody has to click: a document that has
-- been waiting too long EXPIRES, and a party who has not acted gets CHASED.
-- Both are time-driven, so both need a scheduler, and this migration is the
-- database half of that: the columns the schedule reads, the enum value the
-- expiry writes, and the two cron jobs that wake the edge functions up.
--
-- WHY THE JOBS ARE EDGE FUNCTIONS AND NOT plpgsql. Expiry alone could have been
-- pure SQL — flip a status, revoke some tokens. Reminders cannot: they send
-- mail, and the mail path (`shared--send-email`), the audit-append discipline
-- and the token semantics all live in TypeScript already. Running one scheduler
-- for the SQL job and a different mechanism for the mail job would mean two
-- places to look when one of them stops firing. So both jobs are `net.http_post`
-- to an edge function, and everything either of them does is the same code the
-- interactive paths use.
--
-- ⚠ ADDITION NOT IN THE PLAN TEXT — `cron_dispatch_config` + `cron_dispatch()`.
-- The plan says the jobs post "with an `x-cron-secret` header
-- (`CRON_SHARED_SECRET`, read via `requireEnv`)". `requireEnv` is the RECEIVING
-- side. It says nothing about where the SENDING side — Postgres — gets the
-- secret and the functions base URL, and a migration cannot read the edge
-- runtime's environment. Hard-coding either into this file would bake a
-- deployment's URL and a live secret into version control.
--
-- So the two values live in a one-row table with RLS enabled and NO POLICIES AT
-- ALL — the same treatment `signer_access_tokens` and `otp_challenges` get
-- (CG-005): reachable by service_role and the cron owner, invisible to `anon`
-- and `authenticated` through PostgREST. `cron_dispatch()` reads it and NO-OPS
-- LOUDLY when it is unset, so a fresh checkout schedules the jobs without firing
-- them at a URL that does not exist. Populating it is a deployment step,
-- documented in `.env.example`.
--
-- The honest limitation: the secret is stored in plaintext, not hashed, because
-- it must be REPLAYABLE to be sent as a header — the same reason the plan gives
-- for keeping webhook HMAC secrets retrievable rather than digested. Supabase
-- Vault is the production upgrade and needs no change to any caller: only
-- `cron_dispatch`'s SELECT moves.

-- ---------------------------------------------------------------------------
-- PHASE 1: EXTENSION
-- ---------------------------------------------------------------------------
-- pg_cron is already enabled (AHR-848). pg_net is not present anywhere, and it
-- is what lets a scheduled job reach an HTTP endpoint at all.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- PHASE 2: EXPIRY & REMINDER COLUMNS
-- ---------------------------------------------------------------------------

ALTER TABLE public.signature_requests
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    -- Offsets in DAYS SINCE `sent_at`, not absolute dates: a schedule is a
    -- property of how the sender chases, and storing dates would make it
    -- meaningless the moment a draft is sent later than planned.
    ADD COLUMN IF NOT EXISTS reminder_days INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.signature_requests.expires_at IS
    'When this request stops being signable. NULL = never expires. '
    '`envelopes_cron_expire` flips in_progress rows past this to `expired` and '
    'revokes every token. Set at send time from the template''s '
    'default_expiry_days, or chosen by the sender in the composer.';

COMMENT ON COLUMN public.signature_requests.reminder_days IS
    'Reminder offsets in days since sent_at, e.g. {3,7,14}. Empty = no '
    'reminders. `envelopes_cron_remind` fires one per elapsed offset per signer '
    'at current_order, and never re-issues a token — the live link still works.';

ALTER TABLE public.signature_request_signers
    ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.signature_request_signers.last_reminded_at IS
    'When this person was last chased. Together with reminder_days it is what '
    'stops one elapsed offset firing on every cron tick: a reminder fires only '
    'when the offset''s due time is later than this.';

COMMENT ON COLUMN public.signature_request_signers.reminder_count IS
    'How many reminders this person has received. Shown to the sender so '
    '"have they been chased" is answerable without reading the audit trail.';

-- The scan predicate for `envelopes_cron_expire`, indexed the way it queries:
-- only in-flight rows can expire, and rows with no expiry never can. Partial so
-- the completed archive — which is most of the table over time — costs nothing.
CREATE INDEX IF NOT EXISTS idx_signature_requests_expires_at
    ON public.signature_requests (expires_at)
 WHERE status = 'in_progress' AND expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PHASE 3: THE `expired` STATUS
-- ---------------------------------------------------------------------------
-- Terminal, and distinct from `cancelled`: nobody decided this. A sender
-- chasing a stalled document needs to tell "I withdrew it" from "it ran out"
-- from "somebody refused", and collapsing any two of those loses the reason.
--
-- Added here and USED NOWHERE IN THIS FILE. PostgreSQL will not let a value be
-- added to an enum and referenced in the same transaction, and every migration
-- runs in one — the same constraint CG-011 hit and documented. The write is in
-- `envelopes_cron_expire`.
--
-- ⚠ This value makes `pnpm sb:dev:types` fail the frontend build until
-- `const_EnvelopeStatusOptions` labels it: `Envelope_Statuses` is declared
-- `satisfies Record<Envelope_Status, …>`. That is the `bible-supabase-options`
-- type-safety guarantee working as designed, which is why the label ships in
-- the same commit as this migration.

ALTER TYPE public.signature_requests_status_enum
    ADD VALUE IF NOT EXISTS 'expired';

-- ---------------------------------------------------------------------------
-- PHASE 4: TEMPLATE-LEVEL DEFAULTS
-- ---------------------------------------------------------------------------
-- Named in the v1.0 plan's target architecture and never built. They belong on
-- the template because "an NDA lapses in 14 days, a lease offer in 3" is a
-- property of the document kind, not of one send — and the composer defaults
-- from them rather than reading them at expiry time, so changing a template
-- never moves the deadline on something already in flight.

ALTER TABLE public.contract_templates
    ADD COLUMN IF NOT EXISTS default_expiry_days INTEGER,
    ADD COLUMN IF NOT EXISTS default_reminder_days INTEGER[] NOT NULL DEFAULT '{}';

ALTER TABLE public.contract_template_versions
    ADD COLUMN IF NOT EXISTS default_expiry_days INTEGER,
    ADD COLUMN IF NOT EXISTS default_reminder_days INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.contract_templates.default_expiry_days IS
    'Days after sending that a request from this template should expire. NULL = '
    'no default; the composer then offers no expiry unless the sender sets one.';

COMMENT ON COLUMN public.contract_templates.default_reminder_days IS
    'Default reminder offsets in days since sending, e.g. {3,7}. Copied into '
    'signature_requests.reminder_days at send time.';

-- ---------------------------------------------------------------------------
-- PHASE 5: THE VERSIONING HASH MUST COVER THE NEW DEFAULTS
-- ---------------------------------------------------------------------------
-- Not optional. `content_hash` is the dedup key: if the hash does not change,
-- the trigger returns without writing a version row. Two templates differing
-- only in their defaults would hash identically, so changing an expiry default
-- would silently produce NO new version — and the version history would then
-- claim a state that was never saved.
--
-- The version row must carry the columns too, for the same reason it carries
-- `signer_roles`: a version is what `envelopes_send` PINS, and a pinned version
-- that cannot answer "what were the defaults" would have to fall back to the
-- mutable template, which is the coupling versioning exists to remove.

CREATE OR REPLACE FUNCTION public.write_contract_template_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_new_hash TEXT;
    v_last_hash TEXT;
    v_next_version INTEGER;
BEGIN
    -- Field definitions live inside `layout` (CG-001), so the hash covers the
    -- layout plus the role set — and, as of CG-013, the sending defaults.
    v_new_hash := encode(
        digest(
            NEW.type::text || NEW.layout::text
                || coalesce(NEW.pdf_file_path, '')
                || coalesce(NEW.signer_roles::text, '')
                || coalesce(NEW.default_expiry_days::text, '')
                || coalesce(NEW.default_reminder_days::text, ''),
            'sha256'
        ),
        'hex'
    );

    SELECT content_hash, version_number + 1
      INTO v_last_hash, v_next_version
      FROM public.contract_template_versions
     WHERE template_id = NEW.id
     ORDER BY version_number DESC
     LIMIT 1;

    -- Dedup: content unchanged → no new row
    IF v_last_hash IS NOT NULL AND v_last_hash = v_new_hash THEN
        RETURN NEW;
    END IF;

    v_next_version := COALESCE(v_next_version, 1);

    INSERT INTO public.contract_template_versions (
        template_id, organization_id, version_number,
        type, layout, pdf_file_path, signer_roles,
        default_expiry_days, default_reminder_days,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.signer_roles,
        NEW.default_expiry_days, NEW.default_reminder_days,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 6: CRON DISPATCH CONFIG — see the header for why this exists
-- ---------------------------------------------------------------------------
-- Deliberately NOT following the standard table shape from
-- `bible-supabase-schema`: no `generate_id` primary key, no `organization_id`,
-- no org-id trigger, no realtime. It is not a tenant table — it is one row of
-- deployment configuration, and giving it an organization_id would imply per-org
-- cron endpoints that do not exist.

CREATE TABLE IF NOT EXISTS public.cron_dispatch_config (
    id                  TEXT PRIMARY KEY DEFAULT 'singleton'
                        CHECK (id = 'singleton'),
    functions_base_url  TEXT,
    cron_secret         TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_dispatch_config IS
    'One row. The base URL and shared secret pg_cron uses to reach the edge '
    'functions. RLS is ON and there are NO POLICIES — the same default-deny '
    'treatment as signer_access_tokens (CG-005). Populate it as a deployment '
    'step with the values of SUPABASE_URL and CRON_SHARED_SECRET; until then '
    'cron_dispatch() no-ops with a NOTICE rather than posting nowhere.';

-- Seeded empty so `cron_dispatch` has a row to read and reports "not
-- configured" rather than "no configuration row", which are different problems.
INSERT INTO public.cron_dispatch_config (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cron_dispatch_config ENABLE ROW LEVEL SECURITY;
-- No policies. Intentional and load-bearing: this row holds a credential, and
-- an admin who can read it can impersonate the scheduler.

REVOKE ALL ON TABLE public.cron_dispatch_config FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.cron_dispatch_config TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 7: THE DISPATCHER
-- ---------------------------------------------------------------------------
-- One function both jobs call, so the URL construction, the header and the
-- unconfigured no-op exist once. `p_function_name` is validated against an
-- explicit allowlist rather than interpolated: this runs as SECURITY DEFINER and
-- builds a URL, and an unchecked name would let anyone who could call it aim the
-- service at an arbitrary path.

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
    IF p_function_name NOT IN ('envelopes_cron_expire', 'envelopes_cron_remind') THEN
        RAISE EXCEPTION 'cron_dispatch: % is not a schedulable function', p_function_name;
    END IF;

    SELECT functions_base_url, cron_secret
      INTO v_base, v_secret
      FROM public.cron_dispatch_config
     WHERE id = 'singleton';

    -- A NOTICE, not an exception. A fresh local stack has no config and must
    -- still apply this migration and run its jobs harmlessly; raising here would
    -- fill `cron.job_run_details` with failures that mean nothing.
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
        -- Both jobs walk a set of requests sending mail per row. 30s is the
        -- ceiling on how long pg_net waits for the response, not on how long the
        -- function may run — a timeout here loses the RESULT, never the work.
        timeout_milliseconds := 30000
    ) INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.cron_dispatch(TEXT) IS
    'Posts to one of the two scheduled edge functions with the x-cron-secret '
    'header. Returns the pg_net request id, or NULL when '
    'cron_dispatch_config is unpopulated. The function name is allowlisted, not '
    'interpolated — this is SECURITY DEFINER and builds a URL.';

-- Per CG-010's rule: name the roles. A bare `FROM PUBLIC` is inert on this
-- schema — Supabase's pg_default_acl grants EXECUTE to anon and authenticated
-- EXPLICITLY on every newly created function, this one included.
REVOKE EXECUTE ON FUNCTION public.cron_dispatch(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cron_dispatch(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 8: THE SCHEDULE
-- ---------------------------------------------------------------------------
-- `cron.unschedule` first so a re-run replaces rather than duplicates — pg_cron
-- permits two jobs with the same name and would then fire both.
--
-- Hourly, at :07 and :23, off the top of the hour and off each other. Expiry
-- runs first because a request that has just expired must not also be reminded:
-- the reminder job skips anything not `in_progress`, so ordering the two 16
-- minutes apart makes that a fact rather than a race.

SELECT cron.unschedule('envelopes_expire')  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'envelopes_expire');
SELECT cron.unschedule('envelopes_remind')  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'envelopes_remind');

SELECT cron.schedule(
    'envelopes_expire',
    '7 * * * *',
    $$SELECT public.cron_dispatch('envelopes_cron_expire');$$
);

SELECT cron.schedule(
    'envelopes_remind',
    '23 * * * *',
    $$SELECT public.cron_dispatch('envelopes_cron_remind');$$
);

-- ---------------------------------------------------------------------------
-- PHASE 9: VERIFY
-- ---------------------------------------------------------------------------
-- Re-runs CG-010's tripwire over the function this migration added and asserts
-- the two jobs are scheduled exactly once each. An assertion that only checked
-- "a job exists" would pass just as happily with three copies of it.

DO $$
DECLARE
    v_jobs INTEGER;
BEGIN
    IF has_function_privilege('anon', 'public.cron_dispatch(text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.cron_dispatch(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-013: cron_dispatch is reachable by anon/authenticated.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'cron_dispatch_config'
    ) THEN
        RAISE EXCEPTION 'CG-013: cron_dispatch_config has an RLS policy; it must have none.';
    END IF;

    SELECT count(*) INTO v_jobs
      FROM cron.job
     WHERE jobname IN ('envelopes_expire', 'envelopes_remind');

    IF v_jobs <> 2 THEN
        RAISE EXCEPTION 'CG-013: expected 2 scheduled jobs, found %.', v_jobs;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
    ) THEN
        RAISE EXCEPTION 'CG-013: pg_net is not installed; the jobs cannot reach anything.';
    END IF;

    RAISE NOTICE 'CG-013: pg_net installed, 2 jobs scheduled, cron_dispatch locked down.';
END $$;
