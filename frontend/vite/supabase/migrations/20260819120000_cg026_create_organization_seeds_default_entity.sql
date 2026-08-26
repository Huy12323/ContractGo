-- ============================================
-- CG-026: CREATE_ORGANIZATION SEEDS A DEFAULT ENTITY
-- ============================================
-- An organization created through the app could never hold a contract template,
-- and every screen that depended on one failed silently. This closes the hole.
--
-- THE CHAIN. `contract_templates.entity_id` is NOT NULL (20260505133950), and
-- `organization_id` is not supplied by the client at all — it is derived from the
-- entity by the BEFORE INSERT trigger `set_org_id_from_entity()`. So the entity is
-- the ONLY route by which a template acquires an organization, and an organization
-- with zero entities can never hold one. `create_organization` has never made an
-- entity: AHR-556 (20260410133909) removed the `employees` seeding and CG-024
-- (20260819100000) removed the `admins` seeding, but neither ever added the entity
-- the template path requires.
--
-- CG-020 (20260818140100) already noticed this and wrote it down — "create_organization
-- has never created an entity (AHR-556), so a brand-new ContractGo organization has
-- zero entities to point at" — but the fix chosen there was to make `members.entity_id`
-- NULLABLE and route around the hole. That works for membership, which does not need
-- an entity. It cannot work for templates, whose FK is NOT NULL by design.
--
-- WHAT IT LOOKED LIKE. Not an error — silence. `Page_Templates` defaults its entity
-- selector to the first entity and there is none, so `entityId` stays `''`; the create
-- modal's OK button is `disabled: … || !entityId` and its handler opens with
-- `if (!name || !entityId) return`. "Create your first template" was a permanently dead
-- button with no message. `Page_EnvelopeComposer` dead-ends the same way at
-- `ensureAdHocTemplate`'s `if (!entityId) return null`, so Save-draft and Send did
-- nothing at all. The org created through the UI on this database had 0 entities and 0
-- templates; the two seeded orgs, whose entities `seed.sql` writes by hand, worked.
--
-- WHY THE RPC AND NOT A TRIGGER ON `organizations`. `seed.sql` pass 2 inserts its
-- organizations and then its own entities explicitly, with hand-written stable ids. An
-- AFTER INSERT trigger would fire first and hand every seeded org a spurious extra
-- entity that nothing references and the seed cannot make idempotent. The RPC is also
-- provably the only path: it is the sole caller-visible way to create an organization
-- (one frontend caller, `useM_CreateOrgModal_OrganizationCreate`) and there is no other
-- `INSERT INTO public.organizations` anywhere in the migrations or edge functions.
--
-- THE ENTITY STAYS INVISIBLE. This does not promote the entity to a product concept —
-- it keeps it as the plumbing the schema already treats it as. `App_EntitySelector`
-- collapses to a static chip at one entity, so naming it after the organization means
-- the chip reads as the org name rather than as a second thing the user must understand.
-- That naming follows the three prior backfills (20260505084955, 20260505092141,
-- 20260505133950), all of which used `o.name`.
-- ============================================

-- --------------------------------------------
-- PHASE 1: Seed the entity inside the RPC
-- --------------------------------------------
-- Signature is unchanged, so the CG-010 REVOKE/GRANT allow-list entries for
-- create_organization(TEXT) still stand and are not restated here. The `admins`
-- insert CG-024 removed is deliberately NOT reintroduced: the owner is a column,
-- not a tier row.
CREATE OR REPLACE FUNCTION public.create_organization(org_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  new_org_id text;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- `owner_id` IS the membership. No tier row.
  INSERT INTO public.organizations (name, owner_id)
  VALUES (org_name, caller_id)
  RETURNING id INTO new_org_id;

  -- The organization's default entity. Not a choice the user makes — it is the
  -- row `contract_templates.entity_id` points at, without which the organization
  -- cannot hold a document. `timezone` takes its column default of 'UTC' and
  -- `locale` stays NULL; neither is asked for at creation time.
  INSERT INTO public.entities (organization_id, name)
  VALUES (new_org_id, org_name);

  RETURN new_org_id;
END;
$$;

-- --------------------------------------------
-- PHASE 2: Backfill the organizations already stranded
-- --------------------------------------------
-- Idempotent by the NOT EXISTS, and narrowly scoped the way the 20260505133950
-- backfill was: an organization that already has an entity is left exactly as it
-- is, so the seeded orgs keep the one and two entities `seed.sql` gave them.
INSERT INTO public.entities (organization_id, name)
SELECT o.id, o.name
  FROM public.organizations o
 WHERE NOT EXISTS (
     SELECT 1 FROM public.entities e WHERE e.organization_id = o.id
 );

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_orphans int;
    v_seeds   int;
BEGIN
    SELECT count(*) INTO v_orphans
      FROM public.organizations o
     WHERE NOT EXISTS (
         SELECT 1 FROM public.entities e WHERE e.organization_id = o.id
     );

    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'CG-026: % organization(s) still have no entity', v_orphans;
    END IF;

    -- The backfill must not have touched an organization that already had one.
    -- Northwind is seeded with two entities and is the only multi-entity org, so
    -- it is the canary for an over-reaching INSERT.
    SELECT count(*) INTO v_seeds
      FROM public.entities
     WHERE organization_id = 'org_SeedNorthwind001';

    IF v_seeds NOT IN (0, 2) THEN
        RAISE EXCEPTION
            'CG-026: Northwind has % entities, expected 2 (or 0 on a database without the seed)',
            v_seeds;
    END IF;

    RAISE NOTICE 'CG-026: every organization has at least one entity.';
END $$;
