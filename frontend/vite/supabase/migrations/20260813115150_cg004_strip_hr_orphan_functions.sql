-- CG-004 — Remove the HR functions CG-003 left behind.
--
-- `supabase db lint --local` found six functions whose bodies reference tables
-- CG-003 dropped. They were not caught there for two reasons, both worth naming:
--
--   1. `DROP FUNCTION IF EXISTS f()` matches on the FULL SIGNATURE, not the name.
--      CG-003 guessed argument lists for `reorder_employee_views`,
--      `audit_employee_diff` and `seed_org_permissions` and guessed wrong, so
--      every one of those drops silently matched nothing and reported success.
--      Signatures below are taken from pg_proc, not inferred.
--   2. `get_timesheet_grid` was simply missed — it is called only by an RPC from
--      the timesheets page, so nothing in the schema referenced it and nothing
--      failed when it was left behind.
--
-- A plpgsql function body is not validated until it runs, so all six would have
-- stayed silently broken until something called them. That is what `db lint`
-- is for, and why it runs at the end of a strip rather than the start.

-- ============================================================
-- 1. Functions whose signature CG-003 guessed wrong
-- ============================================================

DROP FUNCTION IF EXISTS public.reorder_employee_views(p_ids TEXT[]);
DROP FUNCTION IF EXISTS public.audit_employee_diff(
    p_employee_id TEXT,
    p_organization_id TEXT,
    p_old JSONB,
    p_new JSONB,
    p_skip_keys TEXT[]
);
DROP FUNCTION IF EXISTS public.seed_org_permissions(org_id TEXT) CASCADE;

-- ============================================================
-- 2. Timesheets
-- ============================================================
-- Both overloads. Reads `days`, `correction_tasks`, `timeclock_sessions` and
-- `timeclock_corrections` — all four gone.

DROP FUNCTION IF EXISTS public.get_timesheet_grid(
    p_entity_id TEXT,
    p_start_utc TIMESTAMPTZ,
    p_end_utc TIMESTAMPTZ,
    p_timezone TEXT
);
DROP FUNCTION IF EXISTS public.get_timesheet_grid(
    p_entity_id TEXT,
    p_start_utc TIMESTAMPTZ,
    p_end_utc TIMESTAMPTZ,
    p_timezone TEXT,
    p_employee_ids TEXT[]
);

-- ============================================================
-- 3. Realtime org-id resolution
-- ============================================================
-- Kept and rewritten rather than dropped: every realtime notify trigger calls it
-- to stamp `organization_id` onto the change event, so it is load-bearing for
-- tables that survive.
--
-- Removed: the `departments` and `rel__correction_task__department` branches
-- (their tables are gone), `rel__department__invitation`, and the HR table names
-- from the direct-column list. `employees` becomes `members`.
--
-- The ELSE branch RAISEs a warning and returns NULL rather than failing, so a
-- stale table name here degrades to an event with no organization_id — it does
-- not error. That is precisely why this function has to be corrected explicitly
-- instead of being left to fail loudly on its own.

CREATE OR REPLACE FUNCTION public.get_organization_id_for_change(
    p_table_name TEXT,
    p_record_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    org_id TEXT;
BEGIN
    CASE p_table_name
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        WHEN 'entities', 'admins', 'members',
             'contract_templates', 'contract_template_versions', 'contracts',
             'employee_columns', 'employee_column_choices',
             'onboarding_invitations', 'files', 'folders', 'admin_invitations',
             'signature_requests', 'signature_request_signers',
             'signature_captures' THEN
            org_id := p_record_data->>'organization_id';

        ELSE
            RAISE WARNING 'get_organization_id_for_change: unknown table %', p_table_name;
            RETURN NULL;
    END CASE;

    RETURN org_id;
END;
$function$;

-- ============================================================
-- 4. Verify
-- ============================================================

DO $$
DECLARE
    v_leftover TEXT;
BEGIN
    SELECT string_agg(p.proname, ', ')
    INTO v_leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'reorder_employee_views', 'audit_employee_diff', 'seed_org_permissions',
          'get_timesheet_grid', 'audit_employees_global', 'audit_employees_perorg',
          'authorize', 'approve_correction_task', 'get_managed_correction_task_ids',
          'owns_correction_task', 'set_org_id_from_correction_task',
          'timeclock_process_midnight', 'set_timeclock_event_metadata',
          'check_timeclock_session_per_org_constraint',
          'provision_entity_employees_table', 'clean_employee_views_on_column_delete'
      );

    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION 'CG-004 incomplete — HR functions still present: %', v_leftover;
    END IF;

    RAISE NOTICE 'CG-004 complete.';
END $$;
