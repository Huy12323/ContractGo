-- ============================================
-- AHR-2100: SIGNATURE WORKFLOW — RPCs
-- ============================================
--
-- ⚠ RECONSTRUCTED MIGRATION — see 20260812090000 for the full explanation.
--   Recovered from the live database via pg_get_functiondef() on 2026-08-13.
--
-- The routines that make the workflow safe under concurrency:
--   * signature_audit_entry_hash  — pure, reproducible hash of one log entry
--   * signature_audit_append      — the ONLY writer of signature_audit_log
--   * signature_captures_guard    — immutability + denormalization guard
--   * signature_claim_turn        — atomic "it is my turn, I am signing now"
--   * signature_release_turn      — compensating release when the capture fails
--   * signature_mark_viewed       — records first view
--   * signature_verify_chain      — recomputes the whole chain for a request
-- ============================================

-- ---------------------------------------------------------------------------
-- Entry hash — IMMUTABLE and pure so verification can recompute it years later.
-- ---------------------------------------------------------------------------
-- The timestamp is normalized to UTC with fixed microsecond formatting: any
-- drift in session TimeZone or DateStyle would otherwise silently break every
-- historical hash.

CREATE OR REPLACE FUNCTION public.signature_audit_entry_hash(
    p_prev_hash TEXT,
    p_request_id TEXT,
    p_seq BIGINT,
    p_event_type TEXT,
    p_signer_id TEXT,
    p_actor_user_id UUID,
    p_payload JSONB,
    p_occurred_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT encode(
        digest(
            COALESCE(p_prev_hash, '') || '|' ||
            p_request_id || '|' ||
            p_seq::text || '|' ||
            p_event_type || '|' ||
            COALESCE(p_signer_id, '') || '|' ||
            COALESCE(p_actor_user_id::text, '') || '|' ||
            COALESCE(p_payload, '{}'::jsonb)::text || '|' ||
            to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'),
            'sha256'
        ),
        'hex'
    );
$$;

-- ---------------------------------------------------------------------------
-- Append — the single writer. Takes FOR UPDATE on the tail row so two
-- concurrent events cannot both read the same prev_hash and fork the chain.
-- ---------------------------------------------------------------------------

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
        p_event_type, COALESCE(p_payload, '{}'::jsonb), v_seq, v_prev_hash, v_hash, v_occurred
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Capture guard — rows are write-once, and the denormalized keys must agree
-- with the signer row they were copied from.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.signature_captures_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_signer_user_id UUID;
    v_request_id     TEXT;
    v_found          BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'signature_captures rows are immutable';
    END IF;

    SELECT signer_user_id, request_id, TRUE
      INTO v_signer_user_id, v_request_id, v_found
      FROM public.signature_request_signers
     WHERE id = NEW.signer_id;

    IF NOT COALESCE(v_found, FALSE) THEN
        RAISE EXCEPTION 'signature_captures: unknown signer_id %', NEW.signer_id;
    END IF;

    IF NEW.signer_user_id IS DISTINCT FROM v_signer_user_id
       OR NEW.request_id IS DISTINCT FROM v_request_id THEN
        RAISE EXCEPTION 'signature_captures: denormalized keys do not match signer row %', NEW.signer_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_signature_captures_guard ON public.signature_captures;
CREATE TRIGGER trigger_signature_captures_guard
    BEFORE INSERT OR UPDATE ON public.signature_captures
    FOR EACH ROW EXECUTE FUNCTION public.signature_captures_guard();

-- ---------------------------------------------------------------------------
-- Turn claiming — the concurrency heart of sequential routing.
-- ---------------------------------------------------------------------------
-- A single UPDATE whose WHERE clause asserts every precondition at once: the
-- signer is in a signable state, the request is in flight, and the request's
-- current_order matches this signer's order. Because the assertions and the
-- write are one statement, two signers racing cannot both win — the second sees
-- FOUND = false. Splitting this into a check-then-write in application code
-- would reintroduce exactly that race.

CREATE OR REPLACE FUNCTION public.signature_claim_turn(
    p_request_id TEXT,
    p_signer_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.signature_request_signers s
       SET status = 'signed', signed_at = now()
     WHERE s.id = p_signer_id
       AND s.request_id = p_request_id
       AND s.status IN ('notified', 'viewed')
       AND EXISTS (
           SELECT 1 FROM public.signature_requests r
            WHERE r.id = p_request_id
              AND r.status = 'in_progress'
              AND r.current_order = s.signer_order
       );

    RETURN FOUND;
END;
$$;

-- Compensating action: if the claim succeeded but writing the capture failed,
-- hand the turn back. Deliberately refuses when a capture already exists, so a
-- completed signature can never be silently undone.
CREATE OR REPLACE FUNCTION public.signature_release_turn(
    p_request_id TEXT,
    p_signer_id TEXT
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signature_request_signers
       SET status = 'notified', signed_at = NULL
     WHERE id = p_signer_id
       AND request_id = p_request_id
       AND status = 'signed'
       AND NOT EXISTS (
           SELECT 1 FROM public.signature_captures c WHERE c.signer_id = p_signer_id
       );
$$;

CREATE OR REPLACE FUNCTION public.signature_mark_viewed(p_request_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signature_request_signers
       SET status = 'viewed', viewed_at = now()
     WHERE request_id = p_request_id
       AND signer_user_id = (SELECT auth.uid())
       AND status = 'notified';
$$;

-- ---------------------------------------------------------------------------
-- Chain verification — two independent checks per entry: the stored prev_hash
-- must match the previous row's entry_hash (linkage), AND the entry_hash must
-- be reproducible from the row's own content (integrity). Either alone is
-- forgeable; together they are not.
-- ---------------------------------------------------------------------------

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
            r.prev_hash, r.request_id, r.seq, r.event_type,
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
