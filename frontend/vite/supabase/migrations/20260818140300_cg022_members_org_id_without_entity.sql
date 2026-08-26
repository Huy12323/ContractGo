-- ============================================
-- CG-022: A MEMBER CAN HAVE AN ORGANIZATION WITHOUT AN ENTITY
-- ============================================
-- Caught by running CG-020's member-invitation path end to end, not by the
-- linter: `accept_invitation` inserted a `members` row with an explicit
-- `organization_id` and a NULL `entity_id`, and the BEFORE INSERT trigger
-- overwrote that organization_id with a lookup through the entity, found
-- nothing, and raised
--
--     Cannot resolve organization_id for entity_id <NULL>
--
-- The trigger was written when `entity_id` was NOT NULL and an entity was the
-- ONLY way to know which organization a member belonged to. CG-020 made the
-- column optional because ContractGo organizations have no entities, which
-- turned an always-true precondition into a sometimes-true one.
--
-- The fix keeps the trigger's real job — an entity and an organization must not
-- disagree — and stops it inventing work when there is no entity to consult.
-- ============================================

CREATE OR REPLACE FUNCTION public.set_org_id_from_entity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- With an entity, the entity wins: it is the stronger claim, and letting a
    -- caller pass an organization_id that contradicts its entity is how a row
    -- ends up visible to the wrong organization.
    IF new.entity_id IS NOT NULL THEN
        SELECT organization_id INTO new.organization_id
        FROM public.entities
        WHERE id = new.entity_id;

        IF new.organization_id IS NULL THEN
            RAISE EXCEPTION 'Cannot resolve organization_id for entity_id %', new.entity_id;
        END IF;

        RETURN new;
    END IF;

    -- No entity: the caller must say which organization this is, because
    -- nothing else can. `public.accept_invitation` supplies it from the
    -- invitation row.
    IF new.organization_id IS NULL THEN
        RAISE EXCEPTION 'A member needs either an entity_id or an organization_id';
    END IF;

    RETURN new;
END;
$function$;

-- Both triggers on this table still carry `employees` in their names, missed by
-- the CG-003 rename. Same fix as CG-020 applied to the invitations trigger.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_set_org_id_employees'
          AND tgrelid = 'public.members'::regclass
    ) THEN
        ALTER TRIGGER trigger_set_org_id_employees
          ON public.members RENAME TO trigger_set_org_id_members;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_notify_realtime_employees'
          AND tgrelid = 'public.members'::regclass
    ) THEN
        ALTER TRIGGER trg_notify_realtime_employees
          ON public.members RENAME TO trg_notify_realtime_members;
    END IF;
END $$;
