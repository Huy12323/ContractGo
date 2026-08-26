-- CG-003 — Strip the HR domain.
--
-- ContractGo keeps the document/signature core and the organization shell. This
-- migration removes everything that only existed to manage employees: the
-- timeclock, corrections, departments, the org chart, the employee data grid and
-- its saved views, and the per-entity dynamic employee tables.
--
-- ORDER MATTERS. Leaves first, roots last: dependent tables before the tables
-- they reference, triggers before the functions they call, tables before the
-- enums their columns use. Each section states what it is safe to drop and why.
--
-- DELIBERATELY NOT DROPPED HERE — `employee_columns` and `employee_column_choices`.
-- Phase E severed the TEMPLATE BUILDER's dependency on them, but seven files in
-- the v1 contract/onboarding cluster (App_ContractFiller, App_FormBuilderModal,
-- App_OnboardingWizardModal, App_OnboardingReviewModal, and the preview/versions
-- modals) still read them to label fields, and Phases F–H convert those files
-- rather than rebuild them. Both tables drop in Phase J alongside `contracts` and
-- `onboarding_invitations`, whose lifetime they now share. Dropping them here
-- would break the build for three phases to save one migration.
--
-- REVERSIBILITY: none. This is a data-destroying migration. `/backup` first.

-- ============================================================
-- 0. Announce the dynamic tables before touching anything
-- ============================================================
-- The `ent_<entity_id>__employees` tables are created at runtime by
-- `provision_entity_employees_table()`, so their names are not knowable from the
-- migration history. Emitting the list first means the push log records exactly
-- what this migration destroyed — without it, a bad drop is unattributable.

DO $$
DECLARE
    v_table TEXT;
    v_count INT := 0;
BEGIN
    FOR v_table IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'ent\_%\_\_employees'
        ORDER BY tablename
    LOOP
        RAISE NOTICE 'CG-003 will drop dynamic employee table: %', v_table;
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'CG-003: % dynamic employee table(s) found', v_count;
END $$;

-- ============================================================
-- 1. Entity provisioning triggers
-- ============================================================
-- Dropped before the dynamic tables themselves: the DELETE trigger would
-- otherwise try to drop an already-dropped table when an entity is removed
-- later, and the INSERT trigger would recreate what section 2 just destroyed.

-- Trigger names do NOT mirror their function names here (`trigger_provision_…`
-- vs `tg_provision_…_on_entity_insert`), so these are the names as they exist in
-- pg_trigger, not as inferred from the functions.
DROP TRIGGER IF EXISTS trigger_provision_entity_employees ON public.entities;
DROP TRIGGER IF EXISTS trigger_drop_entity_employees ON public.entities;

DROP FUNCTION IF EXISTS public.tg_provision_entity_employees_on_entity_insert() CASCADE;
DROP FUNCTION IF EXISTS public.tg_drop_entity_employees_on_entity_delete() CASCADE;

-- ============================================================
-- 2. Dynamic per-entity employee tables
-- ============================================================
-- These hold the employee field VALUES; `employee_columns` (kept) holds only the
-- definitions. CG-001 already inlined every label, type and option a template
-- needs into the layout JSONB, so no template reads these tables.

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOR v_table IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'ent\_%\_\_employees'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', v_table);
        RAISE NOTICE 'CG-003 dropped %', v_table;
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.provision_entity_employees_table(TEXT);
DROP FUNCTION IF EXISTS public.provision_entity_employees_table();

-- ============================================================
-- 3. Corrections
-- ============================================================
-- Junction first (it references both correction_tasks and departments), then the
-- task tables, then the functions that only ever served them.

DROP TABLE IF EXISTS public.rel__correction_task__department CASCADE;
DROP TABLE IF EXISTS public.timeclock_corrections CASCADE;
DROP TABLE IF EXISTS public.correction_tasks CASCADE;

DROP FUNCTION IF EXISTS public.approve_correction_task(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.approve_correction_task(TEXT);
DROP FUNCTION IF EXISTS public.get_managed_correction_task_ids();
DROP FUNCTION IF EXISTS public.owns_correction_task(TEXT);
DROP FUNCTION IF EXISTS public.set_org_id_from_correction_task();

-- ============================================================
-- 4. Timeclock
-- ============================================================

DROP TABLE IF EXISTS public.timeclock_sessions CASCADE;
DROP TABLE IF EXISTS public.timeclock_events CASCADE;
DROP TABLE IF EXISTS public.days CASCADE;

DROP FUNCTION IF EXISTS public.check_timeclock_session_per_org_constraint();
DROP FUNCTION IF EXISTS public.set_timeclock_event_metadata();
DROP FUNCTION IF EXISTS public.timeclock_process_midnight();

-- ============================================================
-- 5. Employee audit log and saved views
-- ============================================================
-- The audit log recorded diffs on the dynamic tables dropped in section 2, so it
-- is already describing rows that no longer exist. `employee_views` stored data
-- grid layouts; the grid is gone.

DROP TABLE IF EXISTS public.employee_audit_log CASCADE;
DROP TABLE IF EXISTS public.employee_views CASCADE;

-- `employees` survives (as `members`), so its audit trigger does not go with a
-- dropped table the way the dynamic tables' triggers did — it has to be named.
-- Auditing every member row change is an HR concern; ContractGo's audit surface
-- is the hash-chained signature log, not a per-row diff table.
DROP TRIGGER IF EXISTS trigger_audit_employees ON public.employees;

DROP FUNCTION IF EXISTS public.audit_employee_diff() CASCADE;
DROP FUNCTION IF EXISTS public.audit_employees_global() CASCADE;
DROP FUNCTION IF EXISTS public.audit_employees_perorg() CASCADE;
DROP FUNCTION IF EXISTS public.reorder_employee_views(TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.reorder_employee_views();
-- Fired when an employee_column row was deleted, to prune it out of every saved
-- view's config. `employee_views` is gone, so this now has nothing to clean.
DROP FUNCTION IF EXISTS public.clean_employee_views_on_column_delete() CASCADE;

-- ============================================================
-- 6. Departments and the org chart
-- ============================================================

DROP TABLE IF EXISTS public.rel__department__employee CASCADE;
DROP TABLE IF EXISTS public.rel__department__invitation CASCADE;
DROP TABLE IF EXISTS public.departments CASCADE;

-- ============================================================
-- 7. Role permission matrix
-- ============================================================
-- `authorize()` is already dead code: it reads `public.org_admins` and
-- `public.org_employees`, tables renamed out of existence long before this
-- conversion, so any call would raise. No policy references it — verified
-- against pg_policies — so dropping it and its enum removes a trap rather than a
-- feature. ContractGo authorizes through is_admin_or_owner / is_org_member.

DROP TABLE IF EXISTS public.organization_role_permissions CASCADE;
DROP FUNCTION IF EXISTS public.authorize(TEXT, public.app_permission);
DROP FUNCTION IF EXISTS public.seed_org_permissions() CASCADE;
DROP TYPE IF EXISTS public.app_permission;

-- ============================================================
-- 8. Entities become contract parties
-- ============================================================
-- `correction_approval_mode` decided who signed off on a timeclock correction.
-- Nothing corrects anything now. Timezone and locale stay — they format dates
-- burned onto documents and will drive expiry and reminder scheduling.

ALTER TABLE public.entities DROP COLUMN IF EXISTS correction_approval_mode;

-- ============================================================
-- 9. employees → members
-- ============================================================
-- Kept, not dropped: `is_org_member` depends on it, and ContractGo needs a
-- non-admin tier for internal signers and for staff who send documents but do
-- not administer the organization.
--
-- ALTER TABLE ... RENAME preserves every foreign key, index and policy, so
-- `contracts.employee_id` keeps pointing here without being touched. The three
-- membership helpers are replaced in place below: their SIGNATURES are unchanged,
-- so every policy that calls them keeps working and none need rewriting. That is
-- the whole reason this is a rename and not a new table.

ALTER TABLE IF EXISTS public.employees RENAME TO members;

-- Indexes and constraints carry the old name after a table rename. Renaming them
-- keeps `idx_{table}_{column}` honest, which is the convention the next person
-- will search by.
ALTER INDEX IF EXISTS idx_employees_organization_id RENAME TO idx_members_organization_id;
ALTER INDEX IF EXISTS idx_employees_user_id RENAME TO idx_members_user_id;
ALTER INDEX IF EXISTS idx_employees_entity_id RENAME TO idx_members_entity_id;

CREATE OR REPLACE FUNCTION public.is_org_member(org_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  RETURN EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id AND owner_id = caller_id
  )
  OR EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = org_id AND user_id = caller_id
  )
  OR EXISTS (
    SELECT 1 FROM public.members
    WHERE organization_id = org_id AND user_id = caller_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_organization_role(org_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id AND owner_id = caller_id
  ) THEN
    RETURN 'owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admins
    WHERE organization_id = org_id AND user_id = caller_id
  ) THEN
    RETURN 'admin';
  END IF;

  -- Was 'employee'. `member` is the ContractGo tier: can be a signer and can be
  -- shown documents, cannot administer templates or organization settings.
  IF EXISTS (
    SELECT 1 FROM public.members
    WHERE organization_id = org_id AND user_id = caller_id
  ) THEN
    RETURN 'member';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_member_organizations()
RETURNS TABLE(id TEXT, name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.id, o.name FROM public.organizations o
  WHERE o.owner_id = auth.uid()
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.admins a ON a.organization_id = o.id
  WHERE a.user_id = auth.uid()
  UNION
  SELECT o.id, o.name FROM public.organizations o
  INNER JOIN public.members m ON m.organization_id = o.id
  WHERE m.user_id = auth.uid()
$function$;

-- Resolves organization_id for rows that reference a member. Still named for the
-- column it reads (`employee_id` on `contracts`), which Phase J removes with the
-- table; renaming the function now would mean rewriting triggers twice.
CREATE OR REPLACE FUNCTION public.set_org_id_from_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.members
    WHERE id = NEW.employee_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_id %', NEW.employee_id;
    END IF;

    RETURN NEW;
END;
$function$;

-- ============================================================
-- 10. Enums left without a column
-- ============================================================
-- Dropped last: an enum cannot go while any column still uses it, so every one
-- of these depends on a table dropped above. `employee_column_type` is NOT here
-- — `employee_columns` survives to Phase J and still uses it.

DROP TYPE IF EXISTS public.correction_admin_decision_enum;
DROP TYPE IF EXISTS public.correction_dept_decision_enum;
DROP TYPE IF EXISTS public.correction_task_status_enum;
DROP TYPE IF EXISTS public.entities_correction_approval_mode_enum;
DROP TYPE IF EXISTS public.timeclock_actor_enum;
DROP TYPE IF EXISTS public.timeclock_event_type_enum;
DROP TYPE IF EXISTS public.timeclock_session_type_enum;

-- ============================================================
-- 11. Verify
-- ============================================================
-- Fails the migration rather than leaving a half-stripped schema behind.

DO $$
DECLARE
    v_leftover TEXT;
BEGIN
    SELECT string_agg(tablename, ', ')
    INTO v_leftover
    FROM pg_tables
    WHERE schemaname = 'public'
      AND (tablename LIKE 'ent\_%\_\_employees'
           OR tablename IN (
               'timeclock_events', 'timeclock_sessions', 'timeclock_corrections',
               'correction_tasks', 'rel__correction_task__department', 'days',
               'employee_audit_log', 'employee_views', 'departments',
               'rel__department__employee', 'rel__department__invitation',
               'organization_role_permissions', 'employees'
           ));

    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION 'CG-003 incomplete — still present: %', v_leftover;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'members'
    ) THEN
        RAISE EXCEPTION 'CG-003 incomplete — members table missing after rename';
    END IF;

    RAISE NOTICE 'CG-003 complete.';
END $$;
