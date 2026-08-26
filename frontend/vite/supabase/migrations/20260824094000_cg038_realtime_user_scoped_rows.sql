-- ============================================
-- CG-038: REALTIME — USER-SCOPED ROWS ARE NOT A BUG
-- ============================================
-- `notify_organization_of_table_change` warns when it cannot resolve an
-- organization for a changed row, and that warning is correct: for every table it
-- was written against, an unresolvable org means the big CASE in
-- `get_organization_id_for_change` has fallen behind the schema, and the symptom
-- is silently missing realtime updates.
--
-- CG-037 introduced the first rows for which NULL is the RIGHT answer.
-- `public.files` has always allowed `organization_id IS NULL` — AHR-803 shipped
-- user-scope RLS policies for exactly that — but until CG-037 nothing ever
-- inserted such a row. Now every avatar and every saved signature does, so each
-- one logs a WARNING about a condition that is working as designed. A log line
-- that fires on correct behaviour trains people to ignore the log line, which
-- costs us the case it was written to catch.
--
-- The distinction drawn here is between the two situations the old code
-- conflated:
--
--   the record HAS an `organization_id` field and it is NULL
--       → deliberately user-scoped. No organization to broadcast to, nobody to
--         broadcast at, nothing wrong. Return quietly.
--
--   the resolver returned NULL for anything else
--       → the CASE does not know this table, or a lookup failed. Still a bug,
--         still warned about, unchanged.
--
-- Behaviour is otherwise identical, including the two properties that matter
-- most: this trigger MUST NOT block the originating mutation, and it must skip
-- emission when the parent org is already gone (the cascade-delete case from
-- `20260428144723_realtime_skip_if_org_gone.sql`).

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

    IF org_id IS NULL THEN
        -- CG-038. `?` tests for the KEY, so this is true only when the row really
        -- carries an `organization_id` column that is set to NULL — not when the
        -- resolver simply had nothing to offer. A table without the column at all
        -- still takes the warning branch below.
        IF record_data ? 'organization_id'
           AND record_data ->> 'organization_id' IS NULL THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;

        -- Unresolvable org_id: warn and exit. MUST NOT block the originating mutation.
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
    VALUES (org_id, TG_TABLE_NAME, TG_OP::public.realtime_table_events_event_type_enum, rec_id);

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- CG-010: CREATE OR REPLACE resets the ACL, so the lockdown is restated here.
REVOKE EXECUTE ON FUNCTION public.notify_organization_of_table_change() FROM PUBLIC, anon, authenticated;
