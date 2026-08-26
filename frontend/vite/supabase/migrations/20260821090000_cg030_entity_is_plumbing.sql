-- ============================================
-- CG-030: THE ENTITY BECOMES PLUMBING THE CLIENT NEVER NAMES
-- ============================================
-- `entity` is the last structural leftover of the HR product. There it was a
-- legal/operational branch that employees, departments, timeclock settings and
-- per-entity dynamic tables all hung off. CG-003 dropped that domain, CG-009
-- dropped the remaining NOT NULL `entity_id` consumers, CG-020 and CG-022 made
-- `members.entity_id` first optional and then vestigial, and CG-026 guaranteed
-- exactly one entity per organization.
--
-- What survived reads as a half-built feature rather than a deliberate one. The
-- client still has to KNOW about entities to do anything, because the dependency
-- points the wrong way:
--
--     client sends entity_id  ->  trigger derives organization_id
--
-- `contract_templates.entity_id` is NOT NULL and `organization_id` is not
-- supplied by the client at all (20260505133950 gave it a DEFAULT of ''), so the
-- entity is the only route by which a template acquires an organization. That
-- single fact is why every page carries `entityId` state, a default-to-first
-- effect, a "workspace setup incomplete" gate and an entity selector — and why
-- the template LIST is entity-scoped, so an unresolved entity looks like an empty
-- library rather than an error.
--
-- THIS MIGRATION INVERTS IT.
--
--     client sends organization_id  ->  trigger derives entity_id
--
-- Nothing about the entity's meaning changes; what changes is who names it.
-- Once the organization is the thing the client says, the entity has no
-- client-side representation left at all: no query, no state, no gate, no search
-- param. The frontend half of CG-030 deletes all of it.
--
-- ENTITY IS A LABEL, NEVER AN AUTHORIZATION BOUNDARY. It has never appeared in
-- an RLS predicate and it does not start here. Every policy in this schema
-- authorizes on `organization_id` via `is_org_member` / `is_admin_or_owner` /
-- `has_org_permission` (CG-027). Per-entity access control is out of scope by
-- decision, not by oversight — see `docs/entities.md`.
--
-- WHY `contract_templates.entity_id` STAYS NOT NULL. It is the tripwire. If the
-- resolver below ever fails to find an entity, the insert must fail loudly rather
-- than write a NULL that nothing notices until a report joins on it.
--
-- MINIMUM DIFF, DELIBERATELY. Two adjacent cleanups were considered and left
-- out because both rewrite existing rows: replacing the unique key this drops
-- from `members`, and rescoping `contract_templates`' name uniqueness from
-- per-entity to per-organization. Both are recorded as known follow-ups in
-- `docs/entities.md` rather than smuggled in here.
-- ============================================

-- --------------------------------------------
-- PHASE 1: Invert the contract_templates derivation
-- --------------------------------------------
-- A new function rather than a rewrite of `set_org_id_from_entity()`, because
-- that one is shared with `members` — which loses its entity_id entirely in
-- phase 5 — and the two tables no longer want the same behaviour.
CREATE OR REPLACE FUNCTION public.set_template_org_and_entity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_entity_id text;
BEGIN
    -- DIRECTION 1 — the caller named an entity. Carried over verbatim from
    -- set_org_id_from_entity() (CG-022): the entity wins, because letting a
    -- caller pass an organization_id that contradicts its entity is how a row
    -- ends up visible to the wrong organization. No client takes this path after
    -- CG-030; it is kept for SQL still written entity-first, including seeds and
    -- any future backfill.
    IF new.entity_id IS NOT NULL THEN
        SELECT organization_id INTO new.organization_id
        FROM public.entities
        WHERE id = new.entity_id;

        IF new.organization_id IS NULL THEN
            RAISE EXCEPTION 'Cannot resolve organization_id for entity_id %', new.entity_id;
        END IF;

        RETURN new;
    END IF;

    -- DIRECTION 2 — the caller named the organization, which is what the client
    -- does from CG-030 onward.
    --
    -- The '' test is not defensive noise. 20260505133950 gave organization_id a
    -- DEFAULT of '', so an omitted value arrives here as the empty string and
    -- never as NULL. Checking only for NULL would let '' fall through to a row
    -- whose RLS WITH CHECK then fails with an error naming neither cause.
    IF new.organization_id IS NULL OR new.organization_id = '' THEN
        RAISE EXCEPTION 'A contract template needs an organization_id';
    END IF;

    -- Deterministic by (created_at, id) — the same tiebreak seed.sql and the
    -- 20260505133950 backfill already use. Every organization has exactly one
    -- entity since CG-026, so the ordering only matters for a legacy multi-entity
    -- organization inherited from the HR era: those file new templates under
    -- their oldest entity, which is a LABEL choice and not an access one.
    SELECT id INTO v_entity_id
    FROM public.entities
    WHERE organization_id = new.organization_id
    ORDER BY created_at, id
    LIMIT 1;

    IF v_entity_id IS NULL THEN
        RAISE EXCEPTION
            'Organization % has no entity; it cannot hold a template (see CG-026)',
            new.organization_id;
    END IF;

    new.entity_id := v_entity_id;
    RETURN new;
END;
$function$;

COMMENT ON FUNCTION public.set_template_org_and_entity() IS
    'CG-030: fills whichever of (organization_id, entity_id) the caller did not supply. Entity is a label, never an authorization boundary — RLS on this table is organization_id only.';

-- The trigger it replaces is BEFORE INSERT only (20260505133950), not
-- INSERT OR UPDATE, so there is no update path to carry over.
DROP TRIGGER IF EXISTS trigger_set_org_id_contract_templates ON public.contract_templates;

CREATE TRIGGER trigger_set_org_and_entity_contract_templates
    BEFORE INSERT ON public.contract_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.set_template_org_and_entity();

-- --------------------------------------------
-- PHASE 2: The listing index follows the listing query
-- --------------------------------------------
-- `useQ_Tables_Templates` stops filtering on entity_id and filters on
-- organization_id, so CG-017's entity-scoped index has no query left to serve.
-- AHR-945's idx_contract_templates_active already covers
-- (organization_id, is_archived) but predates is_ad_hoc, so it does not match
-- the library's exact predicate.
CREATE INDEX IF NOT EXISTS idx_contract_templates_org_listable
    ON public.contract_templates (organization_id, is_archived)
    WHERE is_archived = false AND is_ad_hoc = false;

DROP INDEX IF EXISTS public.idx_contract_templates_entity_listable;

-- --------------------------------------------
-- PHASE 3: entities.updated_at starts telling the truth
-- --------------------------------------------
-- The column has existed since 20260403134636 with a DEFAULT of now() and
-- nothing has ever advanced it, so every entity has reported updated_at =
-- created_at for its whole life. `handle_updated_at()` is the function `files`,
-- `folders`, `whitelist` and `user_signatures` all use.
DROP TRIGGER IF EXISTS handle_entities_updated_at ON public.entities;

CREATE TRIGGER handle_entities_updated_at
    BEFORE UPDATE ON public.entities
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------
-- PHASE 4: Index the signature_requests foreign key
-- --------------------------------------------
-- `signature_requests.entity_id` (AHR-2100) has never been indexed, so every
-- delete of an entity — including the cascade from deleting an organization in
-- the Danger Zone — sequentially scans this table to enforce the FK.
--
-- ON DELETE SET NULL is reviewed and KEPT, so the next reader does not
-- re-litigate it: a sent envelope is an immutable record of a transmission, and
-- CASCADE here would let removing a label destroy signed documents. The
-- divergence from contract_templates' CASCADE is intentional.
CREATE INDEX IF NOT EXISTS idx_signature_requests_entity_id
    ON public.signature_requests (entity_id);

-- --------------------------------------------
-- PHASE 5: Drop members.entity_id
-- --------------------------------------------
-- CG-020 made it nullable and CG-022 taught the trigger to live without it. It
-- has been NULL for every member created since, because `accept_invitation` does
-- not set it and nothing else inserts members. Order below is strict.

-- 5a. The dependent policy, and the reason this is not a one-line migration.
--
-- AHR-1980 (20260514120000) gave an employee read access to their own entity via
-- `id IN (SELECT entity_id FROM employees WHERE user_id = auth.uid())`. CG-003's
-- table rename rewrote it to `public.members` and nobody noticed it survived;
-- CG-027 dropped only "Admin or owner can view entities" alongside it. Postgres
-- refuses DROP COLUMN while a policy references the column.
--
-- It grants nothing today — every member's entity_id is NULL, so the IN-list is
-- empty — and CG-027's `org_members_can_view_entities` already covers the same
-- readers more broadly.
DROP POLICY IF EXISTS "employee_can_view_own_entity" ON public.entities;

-- CG-003 (20260813114032) already renamed this from idx_employees_entity_id.
DROP INDEX IF EXISTS public.idx_members_entity_id;

-- 5b. Takes `employees_entity_id_fkey` and `employees_entity_id_user_id_key`
-- with it — the last two identifiers CG-003's rename missed.
--
-- Dropping that unique key leaves `members` with no uniqueness constraint at
-- all. It was already inert for ContractGo: CG-023 recorded that entity_id is
-- NULL for every member and NULLs are distinct in a btree, so it has not
-- prevented a duplicate (organization_id, user_id) since CG-020. Replacing it
-- requires deduplicating existing rows, which is out of scope here — both
-- `accept_invitation` (CG-021) and `set_organization_role` (CG-023) guard with an
-- explicit NOT EXISTS, and the gap is recorded in docs/entities.md.
ALTER TABLE public.members DROP COLUMN IF EXISTS entity_id;

-- 5c. The members trigger can no longer read new.entity_id. Leaving
-- set_org_id_from_entity() attached would raise on the next member insert, so
-- the guard is narrowed to the only check that still has meaning.
--
-- Not SECURITY DEFINER, unlike its predecessor: it reads no table, so it needs
-- no elevation.
CREATE OR REPLACE FUNCTION public.require_member_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    IF new.organization_id IS NULL OR new.organization_id = '' THEN
        RAISE EXCEPTION 'A member needs an organization_id';
    END IF;

    RETURN new;
END;
$function$;

COMMENT ON FUNCTION public.require_member_organization_id() IS
    'CG-030: successor to set_org_id_from_entity() on public.members, which lost its entity_id. Validates only; derives nothing.';

DROP TRIGGER IF EXISTS trigger_set_org_id_members ON public.members;

CREATE TRIGGER trigger_set_org_id_members
    BEFORE INSERT ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.require_member_organization_id();

-- 5d. Nothing calls it now: entity_employees is gone (20260407051711), members
-- has its own guard, contract_templates has set_template_org_and_entity().
-- Deliberately a bare DROP and not CASCADE — failing here is the check that no
-- trigger survived.
DROP FUNCTION IF EXISTS public.set_org_id_from_entity();

-- --------------------------------------------
-- PHASE 6: Stop broadcasting a table nobody reads
-- --------------------------------------------
-- AHR-847 (20260416122226) put entities on the realtime fan-out because the
-- entity settings modal listed them live. That modal is gone and, after the
-- frontend half of CG-030, no client query reads `entities` at all — so every
-- organization creation wrote a realtime_table_events row with no subscriber.
DROP TRIGGER IF EXISTS trg_notify_realtime_entities ON public.entities;

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_count  int;
    v_org    text;
    v_entity text;
BEGIN
    SELECT count(*) INTO v_count
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'members'
       AND column_name = 'entity_id';
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'CG-030: members.entity_id survived';
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_org_id_from_entity';
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'CG-030: set_org_id_from_entity() survived — a trigger must still reference it';
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_policy
     WHERE polname = 'employee_can_view_own_entity';
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'CG-030: employee_can_view_own_entity survived';
    END IF;

    -- CG-026's invariant, restated because phase 1 now depends on it.
    SELECT count(*) INTO v_count
      FROM public.organizations o
     WHERE NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.organization_id = o.id);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-030: % organization(s) have no entity', v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.contract_templates
     WHERE entity_id IS NULL;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CG-030: % template(s) have a NULL entity_id', v_count;
    END IF;

    -- Prove direction 2 for real rather than by inspection: an org-first insert
    -- must come back with an entity the caller never named. Cleaned up in the
    -- same block; a probe that rolled back by raising would abort the migration.
    SELECT id INTO v_org FROM public.organizations ORDER BY created_at, id LIMIT 1;
    IF v_org IS NOT NULL THEN
        INSERT INTO public.contract_templates (organization_id, name, is_ad_hoc)
        VALUES (v_org, 'cg030 probe', true)
        RETURNING entity_id INTO v_entity;

        IF v_entity IS NULL THEN
            RAISE EXCEPTION 'CG-030: an org-first insert did not resolve an entity';
        END IF;

        DELETE FROM public.contract_templates WHERE name = 'cg030 probe';

        RAISE NOTICE 'CG-030: org-first insert resolved entity % for organization %', v_entity, v_org;
    END IF;

    RAISE NOTICE 'CG-030: the entity is plumbing. No client names one.';
END $$;
