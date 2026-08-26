-- CG-009 — Drop the v1 contract / onboarding / employee-column cluster.
--
-- Phase J of the ContractGo conversion. Phase B deliberately deferred
-- `employee_columns` and `employee_column_choices` to here rather than dropping
-- them with the rest of the HR domain: seven files in the v1 contract cluster
-- still read them to resolve field labels and choice options, and dropping the
-- tables while those files existed would have forced a rebuild instead of the
-- conversion Phases F–I actually performed.
--
-- That conversion is done. Nothing under `frontend/vite/src/` references
-- `contracts`, `onboarding_invitations`, `employee_columns` or
-- `employee_column_choices` any more — the v1 send/sign/review surface retired
-- in Phases G, H and I and was replaced by `signature_requests` +
-- `signature_request_signers` + `signer_access_tokens`. So this migration is
-- pure DDL: no frontend change accompanies it beyond pruning four `QueryKeys`
-- entries whose tables no longer exist.
--
-- ORDER MATTERS. Policies that reference a table must go before the table, and
-- `is_invitation_recipient()` must go after the `files` policies that call it.
-- Every drop below names the object explicitly rather than relying on CASCADE,
-- so that an object this migration did not anticipate fails loudly instead of
-- being swept away silently — CG-004 exists because a guessed signature let a
-- drop no-op in exactly that way.

-- ============================================================
-- 1. Policies granting external-signer access to v1 invitees
-- ============================================================
-- These are the "today's external signer is not external" mechanism: they match
-- `auth.jwt() ->> 'email'` against `onboarding_invitations.employee_email`, so
-- the invitee had to be a real authenticated Supabase user. The replacement is
-- `signer_access_tokens` + the public edge functions in `_shared/signerAuth.ts`,
-- which give an external signer NO database grants at all.

DROP POLICY IF EXISTS invitee_can_view_onboarding_invited_contract_templates ON public.contract_templates;
DROP POLICY IF EXISTS invitee_can_view_onboarding_invited_entities ON public.entities;
DROP POLICY IF EXISTS invitee_can_view_onboarding_invited_organizations ON public.organizations;
DROP POLICY IF EXISTS invitee_can_view_onboarding_invited_employee_columns ON public.employee_columns;
DROP POLICY IF EXISTS invitee_can_view_onboarding_invited_employee_column_choices ON public.employee_column_choices;
DROP POLICY IF EXISTS invitee_can_view_own_onboarding_invitations ON public.onboarding_invitations;

-- The three `files` policies, which are the `split_part(r2_key, '/', 4)` policies
-- the plan cites as the demonstration of how brittle the RLS route gets for
-- external access: they parse an object key as a path to recover an invitation
-- id, then trust it. Nothing replaces them — signer file access goes through an
-- edge function that signs the URL itself.

DROP POLICY IF EXISTS invitation_recipients_can_view_invitation_files ON public.files;
DROP POLICY IF EXISTS invitation_recipients_can_insert_invitation_files ON public.files;
DROP POLICY IF EXISTS invitation_recipients_can_update_invitation_files ON public.files;

-- `realtime_table_events` is REWRITTEN, not dropped. Its policy is a two-branch
-- OR: org members see their org's events, and invitees additionally saw events
-- on their own `onboarding_invitations` row. The second branch goes; the first
-- is load-bearing for every surviving table's realtime sync. Renamed to match
-- what it now does, and to the project's `{who}_can_{verb}_{table}` convention.

DROP POLICY IF EXISTS org_member_or_invitee_can_view_realtime_table_events ON public.realtime_table_events;

CREATE POLICY org_members_can_view_realtime_table_events
    ON public.realtime_table_events
    FOR SELECT
    TO authenticated
    USING (public.is_org_member(organization_id));

-- ============================================================
-- 2. Triggers on surviving tables
-- ============================================================
-- `handle_template_deletion_contracts` fires on `contract_templates`, which
-- survives — so unlike the triggers on the dropped tables, this one is not
-- removed by its table going away. It nulls `contracts.contract_template_id`
-- on template deletion, which is the AHR-1487 self-sufficiency invariant applied
-- to v1. The invariant itself lives on in `signature_requests.template_snapshot`,
-- which needs no trigger: the snapshot is copied at send time and never points
-- back at the template row.

DROP TRIGGER IF EXISTS trigger_handle_template_deletion_contracts ON public.contract_templates;

-- ============================================================
-- 3. Tables — children first
-- ============================================================

DROP TABLE IF EXISTS public.contracts;
DROP TABLE IF EXISTS public.onboarding_invitations;
DROP TABLE IF EXISTS public.employee_column_choices;
DROP TABLE IF EXISTS public.employee_columns;

-- ============================================================
-- 4. Functions
-- ============================================================
-- Signatures are taken from `pg_proc`, not inferred — see CG-004's header for
-- why that distinction is not pedantry.

DROP FUNCTION IF EXISTS public.handle_template_deletion_contracts();
DROP FUNCTION IF EXISTS public.is_invitation_recipient(p_invitation_id TEXT);
DROP FUNCTION IF EXISTS public.get_invitation_preview(p_token TEXT);
DROP FUNCTION IF EXISTS public.set_org_id_from_employee_column();

-- Three more the earlier strip missed. Each reads a dropped table or a dropped
-- dynamic `ent_*__employees` table, so each is already broken; a plpgsql body is
-- not validated until it runs, which is why they survived silently.
--
-- `add_employee_column` and `drop_employee_physical_column` are the DDL half of
-- the dynamic per-entity column system CG-003 removed. `set_org_id_from_employee`
-- has had no trigger since the HR strip and resolves an org from an
-- `employee_id` column no surviving table has.

DROP FUNCTION IF EXISTS public.add_employee_column(p_entity_id TEXT, p_col_name TEXT, p_col_type TEXT);
DROP FUNCTION IF EXISTS public.drop_employee_physical_column();
DROP FUNCTION IF EXISTS public.set_org_id_from_employee();

-- Surfaced by the dry run against a restored copy, not by `db lint`. It is the
-- realtime notify trigger function for the dynamic `ent_*__employees` tables,
-- and it takes its org id from `TG_ARGV[0]` and its record id from a
-- `record_data->>'employee_id'` key — so it names no dropped table anywhere in
-- its body and the linter has nothing to catch it by. Zero triggers reference
-- it, and nothing in ContractGo creates tables at runtime for it to serve.

DROP FUNCTION IF EXISTS public.notify_dynamic_table_change();

-- KEPT, despite matching the word "invitation": `accept_invitation`,
-- `has_pending_invitation` and `get_invitation_by_token` all operate on
-- `admin_invitations`, which is the ADMIN invite flow and is untouched by the
-- conversion. Only the `onboarding_` prefixed ones are v1 employee onboarding.

-- ============================================================
-- 5. Realtime org-id resolution
-- ============================================================
-- Rewritten for the same reason CG-004 rewrote it: the ELSE branch only RAISEs a
-- WARNING, so a stale table name here degrades to an event with a NULL
-- organization_id instead of erroring. The four dropped tables come out of the
-- direct-column list. Nothing else changes.

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
             'contract_templates', 'contract_template_versions',
             'files', 'folders', 'admin_invitations',
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
-- 6. Orphaned enums
-- ============================================================
-- Dropped only after their tables, and only these two plus `employee_column_type`
-- — every other enum still backs a live column.
--
-- `contract_template_type_enum` is deliberately NOT dropped even though the
-- `tiptap` template kind is retired: per the plan's design decision 3, the enum
-- VALUE stays so existing `contract_templates` / `contract_template_versions`
-- rows still type-check. Creation is blocked in the UI, not in the type.

DROP TYPE IF EXISTS public.contracts_status_enum;
DROP TYPE IF EXISTS public.onboarding_invitations_status_enum;
DROP TYPE IF EXISTS public.employee_column_type;

-- ============================================================
-- 7. Verify
-- ============================================================
-- Assert rather than trust. Each of the three checks below caught a real defect
-- in an earlier phase of this strip.

DO $$
DECLARE
    v_leftover TEXT;
BEGIN
    -- Tables
    SELECT string_agg(tablename, ', ')
    INTO v_leftover
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('contracts', 'onboarding_invitations',
                        'employee_columns', 'employee_column_choices');

    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION 'CG-009 incomplete — tables still present: %', v_leftover;
    END IF;

    -- Functions
    SELECT string_agg(p.proname, ', ')
    INTO v_leftover
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_template_deletion_contracts', 'is_invitation_recipient',
                        'get_invitation_preview', 'set_org_id_from_employee_column',
                        'add_employee_column', 'drop_employee_physical_column',
                        'set_org_id_from_employee', 'notify_dynamic_table_change');

    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION 'CG-009 incomplete — functions still present: %', v_leftover;
    END IF;

    -- Policies. Catches a policy on a SURVIVING table that still names a dropped
    -- one — Postgres would have refused the table drop, but a policy whose body
    -- merely mentions an invitee concept would not be caught by that.
    SELECT string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
    INTO v_leftover
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname LIKE 'invitee_can_view_onboarding%'
        OR policyname LIKE 'invitation_recipients_can%'
        OR policyname = 'org_member_or_invitee_can_view_realtime_table_events');

    IF v_leftover IS NOT NULL THEN
        RAISE EXCEPTION 'CG-009 incomplete — policies still present: %', v_leftover;
    END IF;

    -- The standing invariant from design decision 2: external signers get zero
    -- database grants, so no policy anywhere may target `anon`. Asserted here
    -- rather than only in a manual check, so a future migration that adds one
    -- fails at push time.
    SELECT count(*)::TEXT
    INTO v_leftover
    FROM pg_policies
    WHERE 'anon' = ANY(roles);

    IF v_leftover <> '0' THEN
        RAISE EXCEPTION 'CG-009 — % policy(ies) grant anon; external access must go through edge functions', v_leftover;
    END IF;

    RAISE NOTICE 'CG-009 complete — v1 onboarding cluster dropped.';
END $$;
