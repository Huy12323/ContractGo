-- ============================================
-- CG-014 — Capture superseding & the sender review loop (v1.1.0 Phase F)
-- ============================================
--
-- The one LOOP in a version otherwise made of forward transitions. Every other
-- route ends: signed, declined, expired, voided. This one sends a specific
-- signer's turn BACK — "the payment terms in section 4 are wrong, please re-read
-- and re-sign" — and then continues from there.
--
-- WHAT IT IS NOT. This is not a final-approval gate: nobody has to approve a
-- completed document, and adding an approver would be adding a party the
-- template has no role for and the burn has no field boxes for. It is not a
-- decline either — a decline is terminal and belongs to the SIGNER. Request
-- changes belongs to the SENDER and leaves the document live.
--
-- THE EVIDENCE PROBLEM THIS FILE EXISTS TO SOLVE. A signature that was genuinely
-- made is evidence even after it is replaced. Deleting the old capture on
-- re-signature would put a hole in exactly the record the hash chain exists to
-- make hole-free: `signer_signed` would sit on the chain naming a
-- `signature_sha256` for an object nobody could produce. So captures are
-- SUPERSEDED, never deleted, and `signature_captures.signer_id`'s UNIQUE — which
-- assumed one signature per signer for all time — becomes a partial unique index
-- over the live row only.
--
-- That trades a write-once guarantee the guard trigger currently enforces
-- ABSOLUTELY for one it enforces conditionally, which is plan risk 4 and the most
-- delicate change in this version. The narrowing below is therefore written as an
-- allowlist of ONE transition compared over the whole row rather than as a list
-- of columns to reject — see PHASE 3.
--
-- ⚠ TWO ADDITIONS THE PLAN TEXT DOES NOT MENTION, both forced, both here rather
-- than in a later migration because the loop is broken without them:
--
--   1. `signature_advance_after_signature` must skip orders that are ALREADY
--      FULLY SIGNED. Rewinding `current_order` backwards is the whole mechanism
--      of this phase, and it creates a state that could not previously exist: an
--      order behind the high-water mark, with later orders already signed. The
--      CG-012 advance takes `min(signer_order) > mine` unconditionally, so after
--      a re-signature it would hand the route to a batch that has nothing left to
--      do — and `notifySignersAtOrder` only mails signers in `pending`/`notified`,
--      so it would mail NOBODY and the route would stall there with no error and
--      nothing to retry. See PHASE 5.
--
--   2. `signature_release_turn` must only be blocked by a LIVE capture. Its
--      `NOT EXISTS (SELECT 1 FROM signature_captures WHERE signer_id = …)` was an
--      exact statement of "this signer has signed" while there could be at most
--      one row. After a supersede it becomes "this signer has EVER signed", so a
--      re-signature whose new capture insert failed could never be released, and
--      the signer would be stuck `signed` with no capture — the precise state
--      that function was written to prevent. See PHASE 4.
--
-- SCOPE DECISION, made here and stated rather than left implicit: v1.1 permits
-- request-changes only while the request is `in_progress`. A `completed` document
-- has been burned, hashed and signed, and third parties may already hold that
-- artifact; re-opening it would invalidate a file already relied upon while
-- leaving its sha256 on the chain as the completed document's digest. Re-opening
-- a completed agreement is a v1.2+ question about superseding a whole DOCUMENT,
-- not about superseding a capture.

-- ---------------------------------------------------------------------------
-- PHASE 1: THE SUPERSEDED MARKER
-- ---------------------------------------------------------------------------

ALTER TABLE public.signature_captures
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.signature_captures.superseded_at IS
    'Set when the sender sends this signer''s turn back (CG-014). The row is kept: '
    'a signature that was genuinely made is evidence even after it is replaced, and '
    'the chain''s signer_signed entry names this row''s signature_sha256. NULL means '
    'this is the capture the burn uses.';

-- The old key said "one capture per signer, ever". The index says "one LIVE
-- capture per signer", which is the invariant the burn actually depends on:
-- `finalizeRequest` maps captures to a role's signature boxes, and two live rows
-- for one signer would make which image gets burned depend on row order.
ALTER TABLE public.signature_captures
    DROP CONSTRAINT IF EXISTS signature_captures_signer_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_captures_signer_id_live
    ON public.signature_captures (signer_id)
 WHERE superseded_at IS NULL;

COMMENT ON INDEX public.idx_signature_captures_signer_id_live IS
    'Replaces signature_captures_signer_id_key. Named per bible-supabase-schema''s '
    'idx_{table}_{column} with the partial qualifier last, matching idx_tcs_open_sessions.';

-- ---------------------------------------------------------------------------
-- PHASE 2: THE SENDER'S REASON
-- ---------------------------------------------------------------------------
-- Deliberately a sibling of `decline_reason` rather than a shared "reason"
-- column. They are written by different parties, read by different surfaces, and
-- one of them is terminal — collapsing them would make "who said this" a question
-- you have to answer from the status.

ALTER TABLE public.signature_request_signers
    ADD COLUMN IF NOT EXISTS changes_requested_reason TEXT;

COMMENT ON COLUMN public.signature_request_signers.changes_requested_reason IS
    'Why the sender sent this turn back. Shown to the signer when they return '
    '(PageSign_Welcome) and hashed into the sender_requested_changes chain entry.';

-- ---------------------------------------------------------------------------
-- PHASE 3: NARROWING THE IMMUTABILITY GUARD
-- ---------------------------------------------------------------------------
-- The guard raises on EVERY update today. It must now permit exactly one
-- transition and keep raising on everything else.
--
-- The "nothing else changed" assertion is written as a whole-row comparison with
-- `superseded_at` masked out, NOT as a column-by-column list. Two reasons, and
-- the second is the load-bearing one:
--
--   * a list of columns is a list that can be incomplete, and being incomplete
--     here means a column silently became mutable;
--   * a column added to this table in some later migration is covered by this
--     form automatically. A future author who adds `capture_device` does not have
--     to know this trigger exists for it to stay immutable.
--
-- NULL → timestamp only. Un-superseding is refused because it would resurrect a
-- second live capture behind the partial index, and re-superseding is refused
-- because the timestamp is evidence of when the sender acted.

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
        IF OLD.superseded_at IS NOT NULL THEN
            RAISE EXCEPTION 'signature_captures: capture % is already superseded', OLD.id;
        END IF;

        IF NEW.superseded_at IS NULL THEN
            RAISE EXCEPTION 'signature_captures rows are immutable';
        END IF;

        IF (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at') THEN
            RAISE EXCEPTION
                'signature_captures: only superseded_at may be set; every other column is immutable';
        END IF;

        RETURN NEW;
    END IF;

    -- INSERT: the denormalized keys must agree with the signer row they were
    -- copied from, unchanged from AHR-2100.
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

    -- A capture arriving already superseded would be a live signature nobody can
    -- see and the burn would skip — a bug in whatever wrote it, not a state to
    -- represent.
    IF NEW.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'signature_captures: a new capture cannot be created superseded';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.signature_captures_guard() IS
    'Immutability + denormalization guard. CG-014 narrowed the UPDATE branch from '
    '"raise always" to "permit only superseded_at NULL -> timestamp, with every '
    'other column bit-identical". The comparison is whole-row with that one key '
    'masked, so a column added later is covered without touching this function.';

-- ---------------------------------------------------------------------------
-- PHASE 4: THE TWO ROUTING FUNCTIONS THAT ASSUMED ONE CAPTURE PER SIGNER
-- ---------------------------------------------------------------------------

-- `signature_claim_turn` — `changes_requested` joins `notified`/`viewed` as a
-- state a signature may be claimed from. Without it the re-signature is refused
-- by the exact function that exists to admit it, and the signer would be told
-- "this document has changed since you opened it" about a change made FOR them.
--
-- `signed_at` is re-stamped by the claim, so a re-signature carries the time it
-- was actually made. The earlier time is not lost: it is on the chain's
-- `signer_signed` entry and on the superseded capture's `captured_at`.
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
       AND s.status IN ('notified', 'viewed', 'changes_requested')
       AND EXISTS (
           SELECT 1 FROM public.signature_requests r
            WHERE r.id = p_request_id
              AND r.status = 'in_progress'
              AND r.current_order = s.signer_order
       );

    RETURN FOUND;
END;
$$;

-- `signature_release_turn` — the NOT EXISTS must name the LIVE capture.
--
-- It read "this signer has a capture, so their signature is real, so refuse to
-- undo it". With supersession that sentence quietly became "this signer has EVER
-- had a capture", and the compensating action would then refuse forever after the
-- first signature: a re-signature whose capture insert failed would leave the
-- signer `signed` with no live capture and no way back — the exact state this
-- function exists to prevent, reintroduced by a clause that used to prevent it.
--
-- The release returns the signer to `notified` rather than to
-- `changes_requested`. Their turn is open either way (`signature_claim_turn`
-- accepts both), and `notified` is the state that says "you have a live link and
-- we are waiting on you", which is true. Restoring `changes_requested` would also
-- have to restore a reason the sender may consider addressed.
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
           SELECT 1 FROM public.signature_captures c
            WHERE c.signer_id = p_signer_id
              AND c.superseded_at IS NULL
       );
$$;

-- ---------------------------------------------------------------------------
-- PHASE 5: THE ADVANCE MUST SKIP ORDERS THAT ARE ALREADY DONE
-- ---------------------------------------------------------------------------
-- Addition 1 from the header. Everything else about CG-012 stands: the row lock,
-- the seven outcomes, `current_order` doing double duty as routing pointer and
-- exactly-once token. Only the next-order search changes.
--
-- Before: `min(signer_order) WHERE signer_order > mine`.
-- After:  `min(signer_order) WHERE signer_order > mine AND status <> 'signed'`.
--
-- The two are IDENTICAL for every route that only ever moves forward — an order
-- ahead of the pointer cannot contain a signature, because `signature_claim_turn`
-- refuses any signer whose order is not the current one. They differ only after a
-- rewind, which is what this phase introduces: the sender sends order 1 back
-- while order 2 has already signed, and the plain minimum would hand the route to
-- order 2, whose parties have nothing to do and whom `notifySignersAtOrder` would
-- not even mail (it selects `pending`/`notified` only). No error, no retry, no
-- signature — a route that stops. With the filter, the re-signature at order 1
-- reaches `finalize` directly, which is the correct reading: every signer has
-- signed.
--
-- `declined` is not excluded and does not need to be: a declined signer means a
-- declined REQUEST, and the status check above this returns `not_in_progress`
-- before any of it runs.
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

    -- CG-014: the next order with something OUTSTANDING, not simply the next
    -- order. See the header of this phase.
    SELECT min(s.signer_order)
      INTO v_next
      FROM public.signature_request_signers s
     WHERE s.request_id     = p_request_id
       AND s.recipient_type = 'signer'
       AND s.signer_order   > v_order
       AND s.status        <> 'signed';

    IF v_next IS NOT NULL THEN
        UPDATE public.signature_requests
           SET current_order = v_next
         WHERE id = p_request_id;

        RETURN QUERY SELECT 'advanced'::TEXT, v_next;
        RETURN;
    END IF;

    -- Past the last outstanding order: nobody can claim a turn from here, and
    -- the next caller to arrive sees v_current <> v_order and returns
    -- 'superseded'. Parking at v_order + 1 rather than at max + 1 is deliberate
    -- and unchanged — `signature_release_finalize` recognises the claim by that
    -- exact arithmetic.
    UPDATE public.signature_requests
       SET current_order = v_order + 1
     WHERE id = p_request_id;

    RETURN QUERY SELECT 'finalize'::TEXT, NULL::INTEGER;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 6: THE LOOP ITSELF
-- ---------------------------------------------------------------------------
-- One function, one transaction, under the same request-row lock the advance
-- takes — so a request-changes and a concurrent submission serialize rather than
-- interleaving. Three writes that must be all-or-nothing:
--
--   1. the signer goes `signed` → `changes_requested` (conditional, so a signer
--      who is not actually signed cannot be sent back);
--   2. their live capture is superseded;
--   3. `current_order` rewinds to their order.
--
-- Doing this from TypeScript across three PostgREST calls would leave every
-- intermediate state reachable, and two of them are actively harmful: a rewound
-- pointer with a signer still `signed` re-opens an order nobody can act on, and a
-- superseded capture with a signer still `signed` is a completed signature with
-- no signature — which the burn would render as a blank signature box on a
-- document it then hashes and calls final.
--
-- OUTCOMES rather than a boolean, following `signature_advance_after_signature`:
--   ok               — sent back; `rewound_to` is the order now current.
--   request_missing  — no such request.
--   not_in_progress  — draft/completed/declined/cancelled/expired. See the scope
--                      decision in the header for why `completed` is refused.
--   not_a_signer     — id pair does not describe a signing party (a cc row is
--                      named rather than assumed away).
--   not_signed       — nothing to send back. The ordinary answer to a stale UI
--                      offering the action against someone who has not signed.
--   finalizing       — `current_order` is parked past the last signer, which
--                      means a burn holds the CG-012 finalize claim right now.
--                      Rewinding into that would race a document being rendered,
--                      hashed and stored: the burn would go on to complete a
--                      request whose signer this call had just un-signed. The
--                      claim is short-lived, so the honest answer is "try again
--                      in a moment", and the alternative (waiting on the burn
--                      inside this transaction) holds a row lock across object
--                      storage I/O.
--
-- The capture id is returned so the caller can chain `capture_superseded` naming
-- the exact row. It is NULL when the signer's role owned no signature field —
-- legitimate (a role may only have data boxes), and not an error.

CREATE OR REPLACE FUNCTION public.signature_request_changes(
    p_request_id TEXT,
    p_signer_id  TEXT,
    p_reason     TEXT
)
RETURNS TABLE(outcome TEXT, superseded_capture_id TEXT, rewound_to INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status        public.signature_requests_status_enum;
    v_current       INTEGER;
    v_order         INTEGER;
    v_type          public.signature_request_signers_recipient_type_enum;
    v_signer_status public.signature_request_signers_status_enum;
    v_max_order     INTEGER;
    v_capture       TEXT;
BEGIN
    SELECT r.status, r.current_order
      INTO v_status, v_current
      FROM public.signature_requests r
     WHERE r.id = p_request_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'request_missing'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    IF v_status <> 'in_progress' THEN
        RETURN QUERY SELECT 'not_in_progress'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT s.signer_order, s.recipient_type, s.status
      INTO v_order, v_type, v_signer_status
      FROM public.signature_request_signers s
     WHERE s.id = p_signer_id
       AND s.request_id = p_request_id;

    IF NOT FOUND OR v_type <> 'signer' THEN
        RETURN QUERY SELECT 'not_a_signer'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    IF v_signer_status <> 'signed' THEN
        RETURN QUERY SELECT 'not_signed'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    SELECT max(s.signer_order)
      INTO v_max_order
      FROM public.signature_request_signers s
     WHERE s.request_id     = p_request_id
       AND s.recipient_type = 'signer';

    IF v_current > v_max_order THEN
        RETURN QUERY SELECT 'finalizing'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    -- The signer write goes FIRST and is conditional, so no capture is
    -- superseded unless the turn was actually taken back. The `status = 'signed'`
    -- predicate is redundant under the lock above — nothing else can move a
    -- signer out of `signed` — and it is written anyway, because "redundant given
    -- the current set of callers" is how a guard stops being true.
    --
    -- `signed_at` is cleared: the signer is no longer signed, and leaving the
    -- timestamp would render as "signed <date>" in the very list the sender uses
    -- to see who they are waiting on. The time is not lost — it is on the chain's
    -- `signer_signed` entry and on the superseded capture's `captured_at`.
    UPDATE public.signature_request_signers
       SET status                   = 'changes_requested',
           changes_requested_reason = p_reason,
           signed_at                = NULL
     WHERE id         = p_signer_id
       AND request_id = p_request_id
       AND status     = 'signed';

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_signed'::TEXT, NULL::TEXT, NULL::INTEGER;
        RETURN;
    END IF;

    UPDATE public.signature_captures
       SET superseded_at = now()
     WHERE signer_id     = p_signer_id
       AND superseded_at IS NULL
    RETURNING id INTO v_capture;

    -- Backwards, which is the only place in the system that moves this pointer
    -- down. Everything downstream already copes: `signature_claim_turn` matches
    -- on it, so the re-signer's turn re-opens and any later party's turn closes
    -- until the route returns to them; their live link keeps working and simply
    -- answers "not your turn yet" (`assertCanAct`) in the meantime.
    UPDATE public.signature_requests
       SET current_order = v_order
     WHERE id = p_request_id;

    RETURN QUERY SELECT 'ok'::TEXT, v_capture, v_order;
END;
$$;

COMMENT ON FUNCTION public.signature_request_changes(TEXT, TEXT, TEXT) IS
    'Sends one signer''s turn back: supersedes their live capture, sets '
    'changes_requested with the sender''s reason, and rewinds current_order to '
    'their order — atomically, under the same request-row lock '
    'signature_advance_after_signature takes. Refuses while a finalize claim is '
    'outstanding rather than racing a burn.';

-- ---------------------------------------------------------------------------
-- PHASE 7: GRANTS
-- ---------------------------------------------------------------------------
-- Per CG-010: name `anon` and `authenticated` explicitly. A bare `FROM PUBLIC`
-- does not remove the explicit EXECUTE that Supabase's pg_default_acl grants to
-- both on every newly created function, and `CREATE OR REPLACE` preserves an
-- existing ACL rather than re-applying the defaults — so the four replaced
-- functions above keep the grants CG-010/CG-012 set, and only the new one needs
-- locking down. All five are revoked anyway, because "it should already be safe"
-- is the assumption Finding 1 was made of.

REVOKE EXECUTE ON FUNCTION public.signature_request_changes(TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_request_changes(TEXT, TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_advance_after_signature(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_advance_after_signature(TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_claim_turn(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_claim_turn(TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_release_turn(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signature_release_turn(TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.signature_captures_guard()
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PHASE 8: VERIFY
-- ---------------------------------------------------------------------------

-- CG-010's whole-schema tripwire, re-run rather than checking only this file's
-- functions. The allowlist is duplicated from CG-010 by necessity — it is a
-- literal in that migration's DO block, not a stored object — and drift between
-- the copies is itself worth failing on.
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
        RAISE EXCEPTION E'CG-014: SECURITY DEFINER function(s) reachable by anon/authenticated outside the allowlist:\n  %', v_leaks;
    END IF;

    RAISE NOTICE 'CG-014: grant surface still clean.';
END $$;

-- The structural facts this phase depends on, asserted rather than assumed:
-- the old blanket UNIQUE is gone, the partial index that replaced it exists and
-- IS partial (a non-partial unique index here would forbid the second capture
-- outright and break re-signing), and the trigger still fires on both operations.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.signature_captures'::regclass
           AND conname  = 'signature_captures_signer_id_key'
    ) THEN
        RAISE EXCEPTION 'CG-014: signature_captures_signer_id_key still exists; re-signing is impossible.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid = 'public.signature_captures'::regclass
           AND c.relname  = 'idx_signature_captures_signer_id_live'
           AND i.indisunique
           AND i.indpred IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'CG-014: idx_signature_captures_signer_id_live is missing, not unique, or not partial.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.signature_captures'::regclass
           AND tgname  = 'trigger_signature_captures_guard'
           AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'CG-014: the capture guard trigger is not installed.';
    END IF;

    IF (SELECT count(*)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
               'signature_request_changes',
               'signature_advance_after_signature',
               'signature_claim_turn',
               'signature_release_turn',
               'signature_captures_guard'
           )
           AND p.prosecdef
           AND p.provolatile = 'v') <> 5 THEN
        RAISE EXCEPTION 'CG-014: expected five SECURITY DEFINER VOLATILE functions after this migration.';
    END IF;

    RAISE NOTICE 'CG-014: capture superseding installed; the review loop is reachable.';
END $$;

-- The guard's narrowing is the riskiest single change in this version (plan risk
-- 4), so it is exercised HERE rather than only in a smoke script: a real capture
-- is inserted, every rejected transition is attempted, the one permitted
-- transition is performed, and the whole thing is rolled back by the surrounding
-- statement's own error handling. A migration that installs a guard and does not
-- prove it rejects anything has installed a comment.
DO $$
DECLARE
    v_signer  TEXT;
    v_request TEXT;
    v_capture TEXT;
    v_failed  TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT s.id, s.request_id INTO v_signer, v_request
      FROM public.signature_request_signers s
     WHERE s.recipient_type = 'signer'
       AND NOT EXISTS (
           SELECT 1 FROM public.signature_captures c WHERE c.signer_id = s.id
       )
     LIMIT 1;

    IF v_signer IS NULL THEN
        RAISE NOTICE 'CG-014: no capture-free signer row available; guard behaviour is asserted by the smoke script instead.';
        RETURN;
    END IF;

    INSERT INTO public.signature_captures (
        signer_id, request_id, signer_user_id, signature_r2_key,
        signature_sha256, capture_method
    )
    SELECT v_signer, v_request, s.signer_user_id, '_cg014_probe/signature.png',
           repeat('0', 64), 'drawn'
      FROM public.signature_request_signers s
     WHERE s.id = v_signer
    RETURNING id INTO v_capture;

    -- 1. A non-superseding UPDATE is still refused.
    BEGIN
        UPDATE public.signature_captures SET capture_method = 'uploaded' WHERE id = v_capture;
        v_failed := v_failed || 'a plain column UPDATE was permitted';
    EXCEPTION WHEN others THEN NULL;
    END;

    -- 2. Superseding while ALSO changing another column is refused — the case a
    --    column allowlist would have missed.
    BEGIN
        UPDATE public.signature_captures
           SET superseded_at = now(), signature_sha256 = repeat('1', 64)
         WHERE id = v_capture;
        v_failed := v_failed || 'superseding while editing another column was permitted';
    EXCEPTION WHEN others THEN NULL;
    END;

    -- 3. The permitted transition.
    UPDATE public.signature_captures SET superseded_at = now() WHERE id = v_capture;
    IF NOT FOUND THEN
        v_failed := v_failed || 'the permitted supersede transition did not apply';
    END IF;

    -- 4. Re-superseding is refused (the timestamp is evidence of when).
    BEGIN
        UPDATE public.signature_captures SET superseded_at = now() WHERE id = v_capture;
        v_failed := v_failed || 're-superseding was permitted';
    EXCEPTION WHEN others THEN NULL;
    END;

    -- 5. Un-superseding is refused (it would resurrect a second live capture).
    BEGIN
        UPDATE public.signature_captures SET superseded_at = NULL WHERE id = v_capture;
        v_failed := v_failed || 'un-superseding was permitted';
    EXCEPTION WHEN others THEN NULL;
    END;

    -- 6. A second LIVE capture for the same signer now inserts — this is what
    --    re-signing needs — and a THIRD does not, because the partial unique
    --    index still holds over the live rows.
    INSERT INTO public.signature_captures (
        signer_id, request_id, signer_user_id, signature_r2_key,
        signature_sha256, capture_method
    )
    SELECT v_signer, v_request, s.signer_user_id, '_cg014_probe/signature-2.png',
           repeat('2', 64), 'drawn'
      FROM public.signature_request_signers s
     WHERE s.id = v_signer;

    BEGIN
        INSERT INTO public.signature_captures (
            signer_id, request_id, signer_user_id, signature_r2_key,
            signature_sha256, capture_method
        )
        SELECT v_signer, v_request, s.signer_user_id, '_cg014_probe/signature-3.png',
               repeat('3', 64), 'drawn'
          FROM public.signature_request_signers s
         WHERE s.id = v_signer;
        v_failed := v_failed || 'two live captures for one signer were permitted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- The probe rows are removed rather than left behind: they name storage
    -- objects that do not exist, and a capture whose image cannot be fetched
    -- would make the burn fail for a real request.
    DELETE FROM public.signature_captures WHERE signature_r2_key LIKE '\_cg014\_probe/%';

    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION 'CG-014: the narrowed capture guard is wrong — %',
            array_to_string(v_failed, '; ');
    END IF;

    RAISE NOTICE 'CG-014: capture guard verified — one transition permitted, five refused.';
END $$;
