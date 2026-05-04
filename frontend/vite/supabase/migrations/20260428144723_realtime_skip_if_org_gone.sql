-- ============================================
-- Fix: realtime trigger skips when parent org is gone
-- ============================================
-- Bug: deleting an organization fails with FK violation on
-- realtime_table_events_organization_id_fkey. The AFTER DELETE trigger
-- trg_notify_realtime_organizations (and AFTER DELETE triggers on every
-- cascading child table) calls notify_organization_of_table_change(),
-- which INSERTs into realtime_table_events with the org_id of the just-
-- deleted row. The org row is invisible under MVCC at FK-check time,
-- so the constraint rejects.
--
-- Fix: in notify_organization_of_table_change(), skip the INSERT when
-- the parent org no longer exists. Cascade-delete events are not
-- emitted to subscribers — acceptable trade-off because:
--   1. The user deleting the org is the only realtime subscriber
--      to that org's data.
--   2. Other org members lose RLS-gated access at the same instant
--      anyway; missing the invalidation isn't observably worse.
--   3. Org deletion is rare in production.
--
-- Trigger bindings (15 tables, AHR-847) are preserved by CREATE OR REPLACE.
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_organization_of_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    record_data JSONB;
    org_id      TEXT;
    rec_id      TEXT;
BEGIN
    -- DELETE uses OLD; INSERT/UPDATE use NEW
    IF TG_OP = 'DELETE' THEN
        record_data := to_jsonb(OLD);
    ELSE
        record_data := to_jsonb(NEW);
    END IF;

    org_id := public.get_organization_id_for_change(TG_TABLE_NAME, record_data);

    -- Unresolvable org_id: warn and exit. MUST NOT block the originating mutation.
    IF org_id IS NULL THEN
        RAISE WARNING 'notify_organization_of_table_change: NULL org_id for table % op %', TG_TABLE_NAME, TG_OP;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Skip realtime emission if the parent org is gone (cascade-delete case).
    -- Prevents FK violation on realtime_table_events.organization_id when
    -- DELETE FROM organizations fires this trigger on the just-deleted row
    -- or its cascading children.
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org_id) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    rec_id := record_data->>'id';

    INSERT INTO public.realtime_table_events (organization_id, table_name, event_type, record_id)
    VALUES (
        org_id,
        TG_TABLE_NAME,
        TG_OP::public.realtime_table_events_event_type_enum,
        rec_id
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
