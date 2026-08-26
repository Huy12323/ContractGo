-- ============================================
-- CG-011 — Routing & CC schema (v1.1.0 Phase B)
-- ============================================
--
-- The one constraint that makes parallel signing impossible:
--
--     UNIQUE (request_id, signer_order)
--
-- `signing_submit` and `App_EnvelopeSignerList` were both written for parallel
-- signers; this key is why the batch size is always exactly 1. Swapping it for
-- UNIQUE (request_id, role_id) is a TIGHTENING, not a loosening — roles may now
-- share an order (that is what parallel means), but a role may not be filled
-- twice, which `envelopes_send` currently asserts in TypeScript only
-- (`index.ts:374-380`, "Each role can have only one recipient").
--
-- ⚠ THIS MIGRATION MUST NOT SHIP WITHOUT CG-012 (Phase C). Lifting the order
-- key exposes a double-finalize race that exists in `signing_submit` today and
-- is masked only by the batch size being 1: two concurrent submitters each read
-- all siblings `signed`, each advance, each call `finalizeRequest`. Two burns,
-- two `request_completed` entries on a chain whose entire purpose is to be the
-- authoritative history. CG-012's `signature_advance_after_signature` is the
-- fix. See risk 2 in the v1.1.0 plan.
--
-- This file also seeds the enum values later phases consume. They are added
-- here rather than where they are used because PostgreSQL will not let a value
-- be added to an enum and referenced in the same transaction, and every
-- migration runs in one — so a phase that both adds and uses a value has to be
-- two migrations. One enum-touching migration up front is cheaper.

-- ---------------------------------------------------------------------------
-- PHASE 1: PRE-FLIGHT — fail loudly BEFORE any DDL
-- ---------------------------------------------------------------------------
-- ADD CONSTRAINT would fail on its own if a request already had two signers on
-- one role, but it would do so mid-migration with a bare constraint-violation
-- message naming neither the request nor the role. Checking first turns that
-- into an actionable error. Failing here is the CORRECT outcome, not a bug in
-- this migration: it means live data already violates the invariant the product
-- claims, and that has to be resolved by hand before routing can be trusted.

DO $$
DECLARE
    v_dupes TEXT;
BEGIN
    SELECT string_agg(
               format('request %s / role %s (%s signers)', request_id, role_id, n),
               E'\n  ')
      INTO v_dupes
      FROM (
          SELECT request_id, role_id, count(*) AS n
            FROM public.signature_request_signers
           WHERE role_id IS NOT NULL
           GROUP BY request_id, role_id
          HAVING count(*) > 1
      ) d;

    IF v_dupes IS NOT NULL THEN
        RAISE EXCEPTION
            E'CG-011: cannot add UNIQUE (request_id, role_id) — these roles are already filled more than once:\n  %',
            v_dupes;
    END IF;

    RAISE NOTICE 'CG-011: no duplicate (request_id, role_id) pairs; safe to swap the key.';
END $$;

-- ---------------------------------------------------------------------------
-- PHASE 2: RECIPIENT TYPE
-- ---------------------------------------------------------------------------
-- A CC observer is a recipient with no turn, expressed structurally rather than
-- by convention. `signature_requests.current_order` is >= 1 and
-- `signature_claim_turn` matches on `r.current_order = s.signer_order`, so
-- pinning CC rows to order 0 means a CC recipient CANNOT take a turn even if a
-- future code path mistakenly asks it to. The guarantee is arithmetic, not
-- discipline.
--
-- Their read access reuses the `signer_access_tokens_purpose_enum` value
-- 'view', which already exists and which `signerAuth.assertCanAct` already
-- rejects for signing with "This link is read-only". Nothing about the
-- read-only path needs inventing — it needs issuing (Phase C).

CREATE TYPE public.signature_request_signers_recipient_type_enum AS ENUM (
    'signer', 'cc'
);

ALTER TABLE public.signature_request_signers
    ADD COLUMN recipient_type public.signature_request_signers_recipient_type_enum
        NOT NULL DEFAULT 'signer';

COMMENT ON COLUMN public.signature_request_signers.recipient_type IS
    'signer = takes a turn at signer_order >= 1. cc = observer, pinned to '
    'signer_order 0 and given a purpose=''view'' token. Because '
    'signature_requests.current_order is always >= 1, a cc row can never '
    'satisfy signature_claim_turn''s order match.';

-- ---------------------------------------------------------------------------
-- PHASE 3: ROLE_ID BECOMES NULLABLE — FOR CC ROWS ONLY
-- ---------------------------------------------------------------------------
-- ⚠ NOT IN THE PHASE B PLAN TEXT, but forced by it: the plan's Phase C says CC
-- rows carry no `role_id`, while CG-006 made the column NOT NULL. A CC observer
-- genuinely has no role — a role owns positioned field boxes on a fixed page,
-- and an observer writes into none of them.
--
-- Rather than trade a NOT NULL for nothing, the requirement moves into a
-- type-aware CHECK: a `signer` MUST have a role, a `cc` MUST NOT. That is
-- strictly stronger than the column constraint it replaces, because it also
-- forbids the previously-representable "CC row that owns field boxes".
--
-- The UNIQUE (request_id, role_id) key below then permits many CC rows per
-- request for free: PostgreSQL treats NULLs as distinct in a unique constraint,
-- so N observers with a NULL role_id never collide, while two signers on one
-- role still do.

ALTER TABLE public.signature_request_signers
    ALTER COLUMN role_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- PHASE 4: THE CONSTRAINT SWAP
-- ---------------------------------------------------------------------------

-- The key this migration exists to remove.
ALTER TABLE public.signature_request_signers
    DROP CONSTRAINT IF EXISTS signature_request_signers_request_id_signer_order_key;

-- Inert today — `envelopes_send` always writes NULL to `signer_user_id`, and
-- PostgreSQL treats NULLs as distinct, so this has never rejected anything. It
-- is dropped rather than kept because it encodes a rule the product does not
-- state: one human may legitimately be both a signer on a document and a CC on
-- it, and CC is exactly the feature this migration introduces. An inert
-- constraint is one that fires for the first time years later, in production,
-- against a case nobody remembers deciding.
ALTER TABLE public.signature_request_signers
    DROP CONSTRAINT IF EXISTS signature_request_signers_request_id_signer_user_id_key;

-- The replacement. Parallel signing is now representable; double-filling a role
-- is now impossible.
ALTER TABLE public.signature_request_signers
    ADD CONSTRAINT signature_request_signers_request_id_role_id_key
        UNIQUE (request_id, role_id);

COMMENT ON CONSTRAINT signature_request_signers_request_id_role_id_key
    ON public.signature_request_signers IS
    'Replaces UNIQUE (request_id, signer_order). Roles sharing an order sign in '
    'parallel; a role may not be filled twice. NULL role_id (cc rows) are '
    'distinct under this key, so a request may carry many observers.';

-- ---------------------------------------------------------------------------
-- PHASE 5: TYPE-AWARE SHAPE CHECK
-- ---------------------------------------------------------------------------
-- Replaces the bare `signer_order >= 1`. One constraint, both halves, so the
-- two facts about a recipient kind can never be satisfied independently:
--
--   signer → order >= 1, has a role
--   cc     → order  = 0, has no role

ALTER TABLE public.signature_request_signers
    DROP CONSTRAINT IF EXISTS signature_request_signers_signer_order_check;

ALTER TABLE public.signature_request_signers
    ADD CONSTRAINT signature_request_signers_recipient_shape_check
    CHECK (
        (recipient_type = 'signer' AND signer_order >= 1 AND role_id IS NOT NULL)
     OR (recipient_type = 'cc'     AND signer_order  = 0 AND role_id IS NULL)
    );

-- Observers are read back per request, as their own section of the detail page,
-- never mixed into the numbered steps. Partial because they are the small
-- minority of rows and the signer path must not pay for the index.
CREATE INDEX idx_signature_request_signers_cc
    ON public.signature_request_signers (request_id)
 WHERE recipient_type = 'cc';

-- ---------------------------------------------------------------------------
-- PHASE 6: ENUM VALUES FOR LATER PHASES
-- ---------------------------------------------------------------------------
-- Added, not used — see the header. `IF NOT EXISTS` so a re-run is a no-op
-- rather than an error.

-- Phase F (request changes → re-sign) needs a status distinct from 'pending':
-- a signer who has been sent back has already seen the document, and the
-- distinction is what the sender's view is reading.
ALTER TYPE public.signature_request_signers_status_enum
    ADD VALUE IF NOT EXISTS 'changes_requested';

-- Six events the routing, reminder, expiry, CC and review paths chain.
-- NOTE: `signature_audit_entry_hash`'s parameter stays TEXT — CG-005 chose that
-- deliberately so entries hashed before an enum change stay verifiable after
-- it. Widening it to the enum type would silently break historical chains.
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'request_expired';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_reminded';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'cc_notified';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'sender_requested_changes';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'capture_superseded';
ALTER TYPE public.signature_audit_log_event_type_enum
    ADD VALUE IF NOT EXISTS 'signer_token_revoked';

-- ---------------------------------------------------------------------------
-- PHASE 7: PER-SIGNER TOKEN REVOCATION
-- ---------------------------------------------------------------------------
-- `signer_token_revoke_for_request` kills every link on a document — right for
-- decline and cancel, far too broad for the rest. Decline-with-reason,
-- request-changes and CC re-issue all need to invalidate ONE person's links
-- while leaving everyone else's turn intact.

CREATE OR REPLACE FUNCTION public.signer_token_revoke_for_signer(p_signer_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_revoked INTEGER;
BEGIN
    UPDATE public.signer_access_tokens
       SET revoked_at = now()
     WHERE signer_id = p_signer_id
       AND revoked_at IS NULL;

    GET DIAGNOSTICS v_revoked = ROW_COUNT;
    RETURN v_revoked;
END;
$$;

COMMENT ON FUNCTION public.signer_token_revoke_for_signer(TEXT) IS
    'Revokes every live token for ONE signer, leaving other recipients'' links '
    'intact. Returns the count so the caller can chain a signer_token_revoked '
    'audit entry recording how many credentials were actually killed. Compare '
    'signer_token_revoke_for_request, which voids the whole document.';

-- Per CG-010's rule: name the roles. A bare `FROM PUBLIC` is inert on this
-- schema, because Supabase's pg_default_acl grants EXECUTE to anon and
-- authenticated EXPLICITLY on every newly created function — this one included,
-- as of the CREATE above. The tripwire at the end of CG-010 will fail this
-- migration if the next two lines are wrong or missing.
REVOKE EXECUTE ON FUNCTION public.signer_token_revoke_for_signer(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signer_token_revoke_for_signer(TEXT)
    TO service_role;

-- ---------------------------------------------------------------------------
-- PHASE 8: VERIFY
-- ---------------------------------------------------------------------------
-- Re-runs CG-010's tripwire over the function this migration just added, and
-- asserts the constraint swap landed in both directions. An assertion that only
-- checked the new key would pass just as happily if the old one had survived.

DO $$
BEGIN
    IF has_function_privilege('anon', 'public.signer_token_revoke_for_signer(text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.signer_token_revoke_for_signer(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'CG-011: signer_token_revoke_for_signer is reachable by anon/authenticated.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.signature_request_signers'::regclass
           AND conname  = 'signature_request_signers_request_id_signer_order_key'
    ) THEN
        RAISE EXCEPTION 'CG-011: the (request_id, signer_order) key survived; parallel signing is still impossible.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.signature_request_signers'::regclass
           AND conname  = 'signature_request_signers_request_id_role_id_key'
    ) THEN
        RAISE EXCEPTION 'CG-011: UNIQUE (request_id, role_id) was not created.';
    END IF;

    RAISE NOTICE 'CG-011: constraint swap verified; parallel signers representable, roles single-filled.';
END $$;
