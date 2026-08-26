-- CG-005 — Public signer surface: access tokens, enums, snapshot self-sufficiency.
--
-- The AHR-2100 signature workflow (20260812090000–093000) is adopted as-is for
-- ContractGo's envelope model. This migration applies the deltas that workflow
-- needs before an EXTERNAL signer — someone with no Supabase account, arriving
-- from an emailed link — can be served.
--
-- Four concerns, in dependency order:
--
--   1. ENUMs. AHR-2100 encoded four fixed-value columns as TEXT + CHECK, which
--      this project's schema rules forbid (`bible-supabase-schema`): the
--      generated TypeScript types get `string`, so a typo survives to runtime,
--      and `Utils_Options_EnumsToOptions` has nothing to build SELECT options
--      from. Converted in place, named `{table}_{column}_enum`.
--
--   2. `signature_captures.signer_user_id` becomes NULLABLE. It was NOT NULL,
--      which silently required every signer to be a real `auth.users` row — the
--      exact limitation the public signing surface exists to remove.
--      `signature_request_signers.signer_user_id` was already nullable.
--
--   3. `signature_requests.template_snapshot`. AHR-2100 stores only
--      `source_pdf_r2_key`; the field layout lived in the template, so hard-
--      deleting a template would leave a sent request unrenderable. The
--      self-sufficiency invariant (AHR-1487/1490/1954) says a sent document must
--      render, validate and burn from its own row. The snapshot is the copy.
--
--   4. `signer_access_tokens` — the bearer credential the emailed link carries.
--
-- SECURITY POSTURE (plan decision #2). External signers get ZERO database
-- grants: there are no `anon` policies anywhere, and this table has NO policies
-- at all, not even for admins. It is reachable only through SECURITY DEFINER
-- routines called by public edge functions. Consequences encoded here:
--   * only the sha256 of a 32-byte CSPRNG value is stored, never the token —
--     a database leak cannot be replayed against the signing surface;
--   * redemption is a single atomic UPDATE (`signer_token_redeem`) so the
--     use-count cap cannot be raced past, the same discipline as
--     `signature_claim_turn`;
--   * every rejection reason is expressible without telling the caller which
--     one applied — the edge function returns one opaque failure.

-- ============================================================
-- 1. ENUM conversions
-- ============================================================
-- Each column is TEXT with a CHECK today. The CHECK is dropped first (it would
-- otherwise be re-validated against the new type and fail on the `=ANY(ARRAY[…])`
-- text comparison), then the column is retyped with an explicit USING cast, then
-- the default is restored — ALTER TYPE drops defaults it cannot cast.

-- Postgres refuses to retype a column any policy expression mentions, so the
-- three state-gated policies from AHR-2100 are dropped and recreated verbatim
-- around the conversion. Their semantics are unchanged: a request is deletable
-- only while draft, and a signer row mutable only while pending.
DROP POLICY IF EXISTS "admin_or_owner_can_delete_signature_requests"
    ON public.signature_requests;
DROP POLICY IF EXISTS "admin_or_owner_can_update_signature_request_signers"
    ON public.signature_request_signers;
DROP POLICY IF EXISTS "admin_or_owner_can_delete_signature_request_signers"
    ON public.signature_request_signers;

CREATE TYPE public.signature_requests_status_enum AS ENUM (
    'draft', 'in_progress', 'completed', 'declined', 'cancelled'
);

ALTER TABLE public.signature_requests
    DROP CONSTRAINT IF EXISTS signature_requests_status_check;
-- Also mentions `status`, so it blocks the retype for the same reason the
-- policies did. Recreated unchanged below.
ALTER TABLE public.signature_requests
    DROP CONSTRAINT IF EXISTS signature_requests_completed_has_pdf;
ALTER TABLE public.signature_requests
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE public.signature_requests_status_enum
        USING status::public.signature_requests_status_enum,
    ALTER COLUMN status SET DEFAULT 'draft';

CREATE TYPE public.signature_request_signers_status_enum AS ENUM (
    'pending', 'notified', 'viewed', 'signed', 'declined'
);

ALTER TABLE public.signature_request_signers
    DROP CONSTRAINT IF EXISTS signature_request_signers_status_check;
ALTER TABLE public.signature_request_signers
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE public.signature_request_signers_status_enum
        USING status::public.signature_request_signers_status_enum,
    ALTER COLUMN status SET DEFAULT 'pending';

-- 'typed' joins 'drawn' and 'uploaded': the signer types their name and it is
-- rendered to a PNG client-side, which is a distinct provenance for the audit
-- trail even though the stored artifact is the same kind of object.
CREATE TYPE public.signature_captures_capture_method_enum AS ENUM (
    'drawn', 'uploaded', 'typed'
);

ALTER TABLE public.signature_captures
    DROP CONSTRAINT IF EXISTS signature_captures_capture_method_check;
ALTER TABLE public.signature_captures
    ALTER COLUMN capture_method TYPE public.signature_captures_capture_method_enum
        USING capture_method::public.signature_captures_capture_method_enum;

-- Five new event types cover the external-signer lifecycle. `signer_access_denied`
-- exists so a failed token attempt is evidence rather than a silent 401 — risk 4
-- in the plan (links leak, mail scanners pre-fetch) is only detectable if the
-- failures are recorded.
CREATE TYPE public.signature_audit_log_event_type_enum AS ENUM (
    'request_created', 'request_sent', 'signer_notified', 'signer_viewed',
    'signer_signed', 'signer_declined', 'request_completed', 'request_cancelled',
    'document_burned', 'integrity_verified',
    'signer_token_issued', 'signer_token_redeemed', 'signer_access_denied',
    'signer_fields_saved', 'document_signed'
);

ALTER TABLE public.signature_audit_log
    DROP CONSTRAINT IF EXISTS signature_audit_log_event_type_check;
ALTER TABLE public.signature_audit_log
    ALTER COLUMN event_type TYPE public.signature_audit_log_event_type_enum
        USING event_type::public.signature_audit_log_event_type_enum;

ALTER TABLE public.signature_requests
    ADD CONSTRAINT signature_requests_completed_has_pdf
    CHECK (status <> 'completed' OR (signed_pdf_r2_key IS NOT NULL AND signed_pdf_sha256 IS NOT NULL));

-- Restore the three policies dropped above the conversion.
CREATE POLICY "admin_or_owner_can_delete_signature_requests"
    ON public.signature_requests FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'draft');

CREATE POLICY "admin_or_owner_can_update_signature_request_signers"
    ON public.signature_request_signers FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'pending');

CREATE POLICY "admin_or_owner_can_delete_signature_request_signers"
    ON public.signature_request_signers FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'pending');

-- ------------------------------------------------------------
-- Functions that touch the retyped columns
-- ------------------------------------------------------------
-- `signature_audit_entry_hash` keeps its TEXT parameter — the hash is a
-- reproducible function of the LOGGED STRING, and pinning it to an enum type
-- would mean every future enum change rewrites the function that verifies
-- historical entries. Callers cast explicitly instead; enum→text and text→enum
-- are both explicit-only casts, so the two functions below must say so.

CREATE OR REPLACE FUNCTION public.signature_audit_append(
    p_request_id TEXT,
    p_organization_id TEXT,
    p_signer_id TEXT,
    p_actor_user_id UUID,
    p_event_type TEXT,
    p_payload JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_seq       BIGINT;
    v_prev_hash TEXT;
    v_hash      TEXT;
    v_occurred  TIMESTAMPTZ := clock_timestamp();
    v_id        TEXT;
BEGIN
    SELECT seq, entry_hash
      INTO v_seq, v_prev_hash
      FROM public.signature_audit_log
     WHERE request_id = p_request_id
     ORDER BY seq DESC
     LIMIT 1
       FOR UPDATE;

    v_seq := COALESCE(v_seq, 0) + 1;

    v_hash := public.signature_audit_entry_hash(
        v_prev_hash, p_request_id, v_seq, p_event_type,
        p_signer_id, p_actor_user_id, COALESCE(p_payload, '{}'::jsonb), v_occurred
    );

    INSERT INTO public.signature_audit_log (
        request_id, organization_id, signer_id, actor_user_id,
        event_type, payload, seq, prev_hash, entry_hash, occurred_at
    ) VALUES (
        p_request_id, p_organization_id, p_signer_id, p_actor_user_id,
        p_event_type::public.signature_audit_log_event_type_enum,
        COALESCE(p_payload, '{}'::jsonb), v_seq, v_prev_hash, v_hash, v_occurred
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.signature_verify_chain(p_request_id TEXT)
RETURNS TABLE(chain_intact BOOLEAN, broken_at_seq BIGINT, entries_checked INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r          RECORD;
    v_expected TEXT;
    v_prev     TEXT := NULL;
    v_count    INTEGER := 0;
    v_broken   BIGINT := NULL;
BEGIN
    FOR r IN
        SELECT * FROM public.signature_audit_log
         WHERE request_id = p_request_id
         ORDER BY seq
    LOOP
        v_count := v_count + 1;

        IF r.prev_hash IS DISTINCT FROM v_prev THEN
            v_broken := r.seq;
            EXIT;
        END IF;

        v_expected := public.signature_audit_entry_hash(
            r.prev_hash, r.request_id, r.seq, r.event_type::text,
            r.signer_id, r.actor_user_id, r.payload, r.occurred_at
        );

        IF v_expected IS DISTINCT FROM r.entry_hash THEN
            v_broken := r.seq;
            EXIT;
        END IF;

        v_prev := r.entry_hash;
    END LOOP;

    RETURN QUERY SELECT (v_broken IS NULL), v_broken, v_count;
END;
$$;

-- ============================================================
-- 2. Captures without an auth.users row
-- ============================================================
-- The guard already compares with IS DISTINCT FROM, which treats NULL = NULL as
-- "agrees", so an external signer's NULL user id on both rows still passes and
-- the guard needs no change. Only the NOT NULL goes.

ALTER TABLE public.signature_captures
    ALTER COLUMN signer_user_id DROP NOT NULL;

COMMENT ON COLUMN public.signature_captures.signer_user_id IS
    'NULL for external signers, who have no auth.users row. Denormalized from '
    'signature_request_signers and enforced to agree by signature_captures_guard.';

-- The signer-facing SELECT policy matches on signer_user_id; with NULLs now
-- possible it must not degrade into "NULL = NULL is unknown, so invisible to
-- everyone" being mistaken for a working policy. External signers never read
-- this table directly — they go through edge functions — so the policy is
-- narrowed to authenticated signers explicitly.
DROP POLICY IF EXISTS "signer_can_view_own_signature_capture" ON public.signature_captures;
CREATE POLICY "signer_can_view_own_signature_capture"
    ON public.signature_captures FOR SELECT TO authenticated
    USING (signer_user_id IS NOT NULL AND signer_user_id = (SELECT auth.uid()));

-- ============================================================
-- 3. Template snapshot on the request
-- ============================================================

ALTER TABLE public.signature_requests
    ADD COLUMN IF NOT EXISTS template_snapshot JSONB;

COMMENT ON COLUMN public.signature_requests.template_snapshot IS
    'Self-sufficient copy of the template at send time — `Template_Snapshot` in '
    'src/types/template.types.ts: { type: "pdf", layout: TemplateField[], '
    'pdf_file_path, signer_roles: SignerRole[], layout_version: 2 }. NULL only '
    'while draft. Never resolve fields through contract_templates at render '
    'time: a sent request must survive its template being hard-deleted '
    '(AHR-1487/1490/1954).';

-- Backfill. Pre-existing AHR-2100 requests kept their positioned fields on
-- `signature_request_signers.fields` and nothing else, so the snapshot is
-- reconstructed from there rather than from the template — which may already
-- have been edited, and whose current layout would therefore misrepresent what
-- was actually signed. One role is synthesized per distinct `signer_order`,
-- which is exactly the routing those rows expressed. Fields are lifted to the
-- v2 shape: `label` falls back to the key, `required` to true (these rows are
-- already signed, so every field they carried was in fact satisfied), and
-- `role_id` is derived from the owning signer.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, source_pdf_r2_key
          FROM public.signature_requests
         WHERE status <> 'draft' AND template_snapshot IS NULL
    LOOP
        UPDATE public.signature_requests req
           SET template_snapshot = jsonb_build_object(
                'type', 'pdf',
                'layout_version', 2,
                'pdf_file_path', r.source_pdf_r2_key,
                'signer_roles', COALESCE((
                    SELECT jsonb_agg(DISTINCT jsonb_build_object(
                        'id',    'rol_signer_' || s.signer_order,
                        'name',  'Signer ' || s.signer_order,
                        'order', s.signer_order,
                        'color', '#6366f1'
                    ))
                    FROM public.signature_request_signers s
                    WHERE s.request_id = r.id
                ), '[]'::jsonb),
                'layout', COALESCE((
                    SELECT jsonb_agg(
                        f - 'key' || jsonb_build_object(
                            'id',       generate_id('tfd'),
                            'key',      f ->> 'key',
                            'label',    COALESCE(f ->> 'label', f ->> 'key'),
                            'role_id',  'rol_signer_' || s.signer_order,
                            'required', COALESCE((f ->> 'required')::boolean, TRUE)
                        )
                    )
                    FROM public.signature_request_signers s
                    CROSS JOIN LATERAL jsonb_array_elements(s.fields) AS f
                    WHERE s.request_id = r.id
                ), '[]'::jsonb)
            )
         WHERE req.id = r.id;
    END LOOP;
END $$;

-- A request that has left draft must carry its snapshot, or the document it
-- asks someone to sign is not reconstructible.
ALTER TABLE public.signature_requests
    ADD CONSTRAINT signature_requests_sent_has_snapshot
    CHECK (status = 'draft' OR template_snapshot IS NOT NULL);

-- ============================================================
-- 4. signer_access_tokens
-- ============================================================

CREATE TYPE public.signer_access_tokens_purpose_enum AS ENUM ('sign', 'view');

CREATE TABLE public.signer_access_tokens (
    id TEXT PRIMARY KEY DEFAULT generate_id('sat'),
    signer_id TEXT NOT NULL REFERENCES public.signature_request_signers(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- sha256 hex of 32 CSPRNG bytes. The plaintext exists exactly once, in the
    -- email that carries it; it is never logged and never stored.
    token_hash TEXT NOT NULL UNIQUE,
    purpose public.signer_access_tokens_purpose_enum NOT NULL DEFAULT 'sign',

    expires_at TIMESTAMPTZ NOT NULL,
    -- Set when the token's purpose is fulfilled (signed / declined). Distinct
    -- from `revoked_at`, which is an administrative act (void, resend).
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    -- Not single-use: a signer legitimately reloads, and mail scanners pre-fetch
    -- links. The cap bounds replay of a leaked link without breaking the normal
    -- flow — see plan risk 4.
    use_count INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 100,
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT signer_access_tokens_max_uses_check CHECK (max_uses >= 1),
    CONSTRAINT signer_access_tokens_use_count_check CHECK (use_count >= 0)
);

CREATE INDEX idx_signer_access_tokens_signer_id
    ON public.signer_access_tokens(signer_id);
CREATE INDEX idx_signer_access_tokens_request_id
    ON public.signer_access_tokens(request_id);
CREATE INDEX idx_signer_access_tokens_organization_id
    ON public.signer_access_tokens(organization_id);

COMMENT ON TABLE public.signer_access_tokens IS
    'Bearer credentials for external signers. RLS is enabled with NO policies at '
    'all — not even for admins — so the table is unreachable from any client key '
    'and readable only by the SECURITY DEFINER routines below.';

CREATE TRIGGER on_signer_access_tokens_updated
    BEFORE UPDATE ON public.signer_access_tokens
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- organization_id is derived from the parent request rather than trusted from
-- the caller, per the project's 1-hop trigger convention.
CREATE OR REPLACE FUNCTION public.set_org_id_from_signature_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
      FROM public.signature_requests
     WHERE id = NEW.request_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for request_id %', NEW.request_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_signer_access_tokens
    BEFORE INSERT ON public.signer_access_tokens
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_signature_request();

ALTER TABLE public.signer_access_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. See the table comment.

-- ------------------------------------------------------------
-- Issue
-- ------------------------------------------------------------
-- Returns the PLAINTEXT token exactly once, to its caller (`envelopes_send`).
-- The caller hands it to the mail template and drops it; nothing persists it.
-- Any previously live token for the same signer and purpose is revoked, so a
-- resend invalidates the older link rather than leaving two valid credentials.

CREATE OR REPLACE FUNCTION public.signer_token_issue(
    p_signer_id TEXT,
    p_purpose TEXT DEFAULT 'sign',
    p_ttl_hours INTEGER DEFAULT 336
)
RETURNS TABLE(token TEXT, token_id TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_request_id TEXT;
    v_token      TEXT;
    v_hash       TEXT;
    v_expires    TIMESTAMPTZ := now() + make_interval(hours => p_ttl_hours);
    v_id         TEXT;
BEGIN
    SELECT request_id INTO v_request_id
      FROM public.signature_request_signers
     WHERE id = p_signer_id;

    IF v_request_id IS NULL THEN
        RAISE EXCEPTION 'signer_token_issue: unknown signer_id %', p_signer_id;
    END IF;

    UPDATE public.signer_access_tokens
       SET revoked_at = now()
     WHERE signer_id = p_signer_id
       AND purpose = p_purpose::public.signer_access_tokens_purpose_enum
       AND revoked_at IS NULL
       AND consumed_at IS NULL;

    -- 32 bytes of CSPRNG, base64url-encoded. gen_random_bytes comes from
    -- pgcrypto, which this project already depends on for the audit hash chain.
    v_token := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
    v_hash  := encode(digest(v_token, 'sha256'), 'hex');

    INSERT INTO public.signer_access_tokens (signer_id, request_id, token_hash, purpose, expires_at)
    VALUES (
        p_signer_id, v_request_id, v_hash,
        p_purpose::public.signer_access_tokens_purpose_enum, v_expires
    )
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_token, v_id, v_expires;
END;
$$;

-- ------------------------------------------------------------
-- Redeem
-- ------------------------------------------------------------
-- The authorization primitive. ONE statement asserts every precondition and
-- performs the accounting, so concurrent requests cannot both slip past the
-- use cap — the same reason `signature_claim_turn` is a single UPDATE.
--
-- Returns zero rows on any failure and never says which precondition failed;
-- distinguishing "expired" from "revoked" from "no such token" would let an
-- attacker probe for live tokens.

CREATE OR REPLACE FUNCTION public.signer_token_redeem(
    p_token_hash TEXT,
    p_ip TEXT DEFAULT NULL
)
RETURNS TABLE(
    token_id TEXT,
    signer_id TEXT,
    request_id TEXT,
    organization_id TEXT,
    purpose public.signer_access_tokens_purpose_enum
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE public.signer_access_tokens t
       SET use_count    = t.use_count + 1,
           last_used_at = now(),
           last_used_ip = COALESCE(p_ip::inet, t.last_used_ip)
     WHERE t.token_hash = p_token_hash
       AND t.revoked_at IS NULL
       AND t.consumed_at IS NULL
       AND t.expires_at > now()
       AND t.use_count < t.max_uses
    RETURNING t.id, t.signer_id, t.request_id, t.organization_id, t.purpose;
$$;

-- Fulfils the token — called after the signer signs or declines. Idempotent.
CREATE OR REPLACE FUNCTION public.signer_token_consume(p_token_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signer_access_tokens
       SET consumed_at = now()
     WHERE id = p_token_id
       AND consumed_at IS NULL;
$$;

-- Administrative revocation — void, cancel, or re-send with a fresh link.
CREATE OR REPLACE FUNCTION public.signer_token_revoke_for_request(p_request_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signer_access_tokens
       SET revoked_at = now()
     WHERE request_id = p_request_id
       AND revoked_at IS NULL;
$$;

-- ------------------------------------------------------------
-- Token-authenticated view marking
-- ------------------------------------------------------------
-- `signature_mark_viewed(request_id)` resolves the signer through auth.uid(),
-- which an external signer does not have. This variant takes the signer id the
-- redeemed token already proved, and is therefore only as trustworthy as its
-- caller — which is why it is not exposed to any client role.

CREATE OR REPLACE FUNCTION public.signature_mark_viewed_by_signer(p_signer_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signature_request_signers
       SET status = 'viewed', viewed_at = now()
     WHERE id = p_signer_id
       AND status = 'notified';
$$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
-- SECURITY DEFINER alone does not restrict who may CALL a function, and the
-- default grant is EXECUTE to PUBLIC. These five would let any authenticated
-- client mint or redeem a signer credential, so PUBLIC is revoked and only
-- service_role — the key edge functions run under — keeps EXECUTE.

REVOKE EXECUTE ON FUNCTION public.signer_token_issue(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signer_token_consume(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signature_mark_viewed_by_signer(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.signer_token_issue(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_redeem(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_consume(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.signer_token_revoke_for_request(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.signature_mark_viewed_by_signer(TEXT) TO service_role;

-- `signature_audit_append` has the same exposure: any authenticated client could
-- forge evidence into the chain. It predates this migration ungranted, so it is
-- locked down here alongside the rest.
REVOKE EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_audit_append(TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
