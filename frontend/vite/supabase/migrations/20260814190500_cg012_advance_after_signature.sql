-- ============================================
-- CG-012 — Atomic routing advance (v1.1.0 Phase C)
-- ============================================
--
-- CG-011 removed UNIQUE (request_id, signer_order) so that two parties may share
-- an order and sign in parallel. That key was also, accidentally, the only thing
-- keeping `signing_submit` correct: with a batch size of exactly 1 there was
-- never a second submitter to race. There is now.
--
-- THE RACE THIS FILE CLOSES. Steps 5 and 6 of `signing_submit` are a
-- read-decide-write across three separate PostgREST calls, each its own
-- transaction:
--
--     SELECT siblings                      -- A and B both read
--     every sibling signed? -> yes         -- A and B both conclude yes
--     UPDATE current_order / finalize      -- A and B both act
--
-- Two signers at the same order submitting within the same few hundred
-- milliseconds each observe the other already `signed` (the claim in step 3 has
-- landed by then for both) and each proceeds to finalize. The document is burned
-- twice, stored twice, and — the part that actually matters — `request_completed`
-- is appended to the hash chain twice. A chain whose whole purpose is to be the
-- authoritative account of what happened would then contain an account of
-- something that happened once, recorded as having happened twice.
--
-- THE FIX, and why it is in the database rather than in TypeScript. The decision
-- and the write become one transaction under a row lock on `signature_requests`,
-- and the right to act is claimed by a state change the loser can observe:
--
--     SELECT ... FROM signature_requests WHERE id = ? FOR UPDATE
--
-- B blocks on A's lock, and when it proceeds it re-reads `current_order` — which
-- A has already moved — and returns `superseded` rather than acting. No
-- application-level mutex can offer this, because edge function instances do not
-- share memory and PostgREST will not span the three calls in one transaction.
--
-- `current_order` is doing double duty here, deliberately: it is both the
-- routing pointer and the exactly-once token. Advancing it to the next order
-- claims "I advanced this"; advancing it PAST the last order claims "I am the
-- one finalizing". Both are single-statement writes under the lock, so both are
-- atomic, and neither needs a column that exists only to be a flag.
--
-- The finalize claim leaves `current_order` at last + 1, where no signer's order
-- can match it. That is not a side effect — it is the point. It means
-- `signature_claim_turn` refuses every submission from the moment finalization
-- begins, closing the window in which a straggler could sign a document that is
-- already being burned. `signature_requests_current_order_check` (>= 1) is
-- untroubled by it, and `signature_release_finalize` below hands it back if the
-- burn fails, mirroring `signature_release_turn`'s compensating role for step 4.

-- ---------------------------------------------------------------------------
-- PHASE 1: THE ADVANCE
-- ---------------------------------------------------------------------------
-- Returns an outcome the caller must switch on rather than a boolean, because
-- "did not advance" has five distinct causes and only one of them ('waiting')
-- is the ordinary path. Collapsing them would leave `signing_submit` unable to
-- tell a healthy parallel batch from a request that was cancelled underneath it.
--
--   waiting         — batch incomplete; other parties at this order still owe a
--                     signature. The overwhelmingly common non-final outcome.
--   advanced        — this signer completed the batch; `current_order` now
--                     points at `next_order` and its parties must be notified.
--   finalize        — this signer completed the LAST batch and has claimed the
--                     exclusive right to burn, sign, store and complete.
--   superseded      — another submitter at this order already advanced past us.
--                     The signature is recorded and valid; there is simply
--                     nothing left for this caller to do. NOT an error.
--   not_in_progress — cancelled, declined or already completed while in flight.
--   request_missing / not_a_signer — the caller passed ids that do not describe
--                     a signing party of this request (a cc row reaches here
--                     only through a bug; it is named rather than assumed away).

CREATE OR REPLACE FUNCTION public.signature_advance_after_signature(
    p_request_id TEXT,
    p_signer_id  TEXT
)
RETURNS TABLE(outcome TEXT, next_order INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status  public.signature_requests_status_enum;
    v_current INTEGER;
    v_order   INTEGER;
    v_type    public.signature_request_signers_recipient_type_enum;
    v_pending INTEGER;
    v_next    INTEGER;
BEGIN
    -- The serialization point. Every concurrent submitter on this request queues
    -- here, so everything below runs against state nobody else is mutating.
    SELECT r.status, r.current_order
      INTO v_status, v_current
      FROM public.signature_requests r
     WHERE r.id = p_request_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'request_missing'::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    IF v_status <> 'in_progress' THEN
        RETURN QUERY SELECT 'not_in_progress'::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT s.signer_order, s.recipient_type
      INTO v_order, v_type
      FROM public.signature_request_signers s
     WHERE s.id = p_signer_id
       AND s.request_id = p_request_id;

    IF NOT FOUND OR v_type <> 'signer' THEN
        RETURN QUERY SELECT 'not_a_signer'::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    -- The exactly-once guard. A caller whose order is no longer the request's
    -- current order lost the race — its co-signer already moved the pointer.
    IF v_current <> v_order THEN
        RETURN QUERY SELECT 'superseded'::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    -- Only signing parties gate the batch. CC rows sit at order 0 and would be
    -- excluded by the order match alone; the recipient_type filter states the
    -- intent rather than relying on that arithmetic holding forever.
    SELECT count(*)
      INTO v_pending
      FROM public.signature_request_signers s
     WHERE s.request_id     = p_request_id
       AND s.recipient_type = 'signer'
       AND s.signer_order   = v_order
       AND s.status        <> 'signed';

    IF v_pending > 0 THEN
        RETURN QUERY SELECT 'waiting'::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT min(s.signer_order)
      INTO v_next
      FROM public.signature_request_signers s
     WHERE s.request_id     = p_request_id
       AND s.recipient_type = 'signer'
       AND s.signer_order   > v_order;

    IF v_next IS NOT NULL THEN
        UPDATE public.signature_requests
           SET current_order = v_next
         WHERE id = p_request_id;

        RETURN QUERY SELECT 'advanced'::TEXT, v_next;
        RETURN;
    END IF;

    -- Past the last order: nobody can claim a turn from here, and the next
    -- caller to arrive sees v_current <> v_order and returns 'superseded'.
    UPDATE public.signature_requests
       SET current_order = v_order + 1
     WHERE id = p_request_id;

    RETURN QUERY SELECT 'finalize'::TEXT, NULL::INTEGER;
END;
$$;

COMMENT ON FUNCTION public.signature_advance_after_signature(TEXT, TEXT) IS
    'Decides and performs the routing step after a signature, atomically. Locks '
    'the request row, so concurrent submitters at one order serialize and '
    'exactly one receives ''advanced'' or ''finalize'' — the rest get '
    '''superseded''. Replaces the read-decide-write across separate PostgREST '
    'calls in signing_submit, which CG-011''s removal of UNIQUE (request_id, '
    'signer_order) turned from theoretical into reachable.';

-- ---------------------------------------------------------------------------
-- PHASE 2: RELEASING AN UNUSED FINALIZE CLAIM
-- ---------------------------------------------------------------------------
-- The burn is not part of the claiming transaction and cannot be: it fetches a
-- PDF and a font from object storage, renders, hashes, signs and uploads. If any
-- of that fails, `current_order` is stranded at last + 1 — a request that is
-- in_progress but which no signer can act on, and which nothing would retry.
--
-- This is the same shape as `signature_release_turn` and refuses in the same
-- spirit: it will not move the pointer back if the request already reached
-- `completed`, so a finalize that succeeded cannot be un-done by a failure in
-- whatever ran after it.

CREATE OR REPLACE FUNCTION public.signature_release_finalize(
    p_request_id TEXT,
    p_signer_id  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.signature_requests r
       SET current_order = s.signer_order
      FROM public.signature_request_signers s
     WHERE r.id            = p_request_id
       AND s.id            = p_signer_id
       AND s.request_id    = r.id
       AND r.status        = 'in_progress'
       -- Only a claim this signer itself made, and only the finalize claim:
       -- an 'advanced' pointer is one greater than SOME order but there is
       -- always a signer at it, which the NOT EXISTS below excludes.
       AND r.current_order = s.signer_order + 1
       AND NOT EXISTS (
           SELECT 1
             FROM public.signature_request_signers n
            WHERE n.request_id     = r.id
              AND n.recipient_type = 'signer'
              AND n.signer_order   > s.signer_order
       );

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.signature_release_finalize(TEXT, TEXT) IS
    'Compensating action for a finalize claim whose burn failed: moves '
    'current_order back so a retry can claim it again. Refuses once the request '
    'is completed. Compare signature_release_turn, which compensates a claimed '
    'turn whose capture failed.';

-- ---------------------------------------------------------------------------
-- PHASE 3: GRANTS
-- ---------------------------------------------------------------------------
-- Both functions drive the routing state machine and are reachable only through
-- `signing_submit` under the service role. Per CG-010: name anon and
-- authenticated explicitly — a bare `FROM PUBLIC` does not remove the explicit
-- EXECUTE that Supabase's pg_default_acl grants to both on every new function.

REVOKE EXECUTE ON FUNCTION public.signature_advance_after_signature(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_advance_after_signature(TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_release_finalize(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_release_finalize(TEXT, TEXT)
    TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 4: VERIFY
-- ---------------------------------------------------------------------------
-- Re-runs CG-010's whole-schema tripwire rather than checking only the two
-- functions added here. The allowlist is duplicated from CG-010 by necessity —
-- it is a literal in that migration's DO block, not a stored object — and any
-- drift between the two copies is itself worth failing on.

DO $$
DECLARE
    v_anon_allowed TEXT[] := ARRAY[
        'get_invitation_by_token',
        'is_org_member',
        'is_admin_or_owner',
        'get_organization_role'
    ];
    v_auth_allowed TEXT[] := v_anon_allowed || ARRAY[
        'accept_invitation',
        'create_organization',
        'has_pending_invitation',
        'get_my_member_organizations',
        'signature_mark_viewed',
        'signature_verify_chain_for_member'
    ];
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
       AND (
             (has_function_privilege('anon', p.oid, 'EXECUTE')          AND NOT (p.proname = ANY(v_anon_allowed)))
          OR (has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT (p.proname = ANY(v_auth_allowed)))
       );

    IF v_leaks IS NOT NULL THEN
        RAISE EXCEPTION E'CG-012: SECURITY DEFINER function(s) reachable by anon/authenticated outside the allowlist:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-012: grant surface still clean.';
END $$;

-- The advance function is worthless if it is not SECURITY DEFINER and volatile:
-- a STABLE marking would let the planner reuse a snapshot across the lock, and
-- INVOKER rights would make it unusable from the token-authenticated path.
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    SELECT string_agg(p.proname, ', ')
      INTO v_bad
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('signature_advance_after_signature', 'signature_release_finalize')
       AND (NOT p.prosecdef OR p.provolatile <> 'v');

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'CG-012: % is not SECURITY DEFINER VOLATILE.', v_bad;
    END IF;

    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('signature_advance_after_signature', 'signature_release_finalize')) <> 2 THEN
        RAISE EXCEPTION 'CG-012: expected both routing functions to exist.';
    END IF;

    RAISE NOTICE 'CG-012: atomic advance installed; double-finalize race closed.';
END $$;
