-- ===========================================================================
-- CG-046 — ONE NOTIFICATION TYPE FOR A DISABLED WEBHOOK ENDPOINT
-- ===========================================================================
--
-- v1.4.0 Phase D. `webhooks_deliver-pending` disables an endpoint after
-- CIRCUIT_BREAKER_THRESHOLD consecutive failures, and that has to be announced.
--
-- A SILENTLY DISABLED ENDPOINT IS HOW AN INTEGRATION DIES UNNOTICED. Nobody
-- watches an edge function's log; the fan-out simply stops selecting the
-- endpoint, so from that moment on there is no outward sign at all — no error,
-- no queue, no retry. The customer discovers it when their own system is a week
-- out of date. An in-app notification is the cheapest thing that turns silence
-- into a signal.
--
-- ═══ WHY THIS IS ITS OWN MIGRATION ═══
--
-- `ALTER TYPE … ADD VALUE` cannot be REFERENCED in the transaction that adds it,
-- and `db push` runs each migration in one. CG-045 could not have carried this
-- value AND its behavioural probe, because that probe inserts rows. Splitting is
-- the documented remedy — CG-043's header states it in the imperative — rather
-- than reaching for a workaround.
--
-- Nothing in this file references the new value. The only writer is edge
-- function TypeScript running long after this commits.
-- ===========================================================================

ALTER TYPE public.notifications_type_enum
    ADD VALUE IF NOT EXISTS 'webhook_endpoint_disabled';


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- The value is castable but deliberately UNUSED. Both halves matter: the first
-- proves the ALTER took, the second proves this migration kept its promise not
-- to reference it — a row written here would have failed the push with
-- "unsafe use of new value of enum type", so an assertion that finds none is
-- also a check that the file did not quietly grow one.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'notifications_type_enum'
           AND e.enumlabel = 'webhook_endpoint_disabled'
    ) THEN
        RAISE EXCEPTION 'CG-046: webhook_endpoint_disabled was not added to notifications_type_enum.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.notifications
         WHERE type::TEXT = 'webhook_endpoint_disabled'
    ) THEN
        RAISE EXCEPTION 'CG-046: a notification of the new type already exists; this migration must write none.';
    END IF;

    RAISE NOTICE 'CG-046: webhook_endpoint_disabled added, unused, and the frontend tripwire will now demand a label.';
END $$;
