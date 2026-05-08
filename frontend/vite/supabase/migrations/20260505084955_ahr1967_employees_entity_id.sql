-- ============================================
-- AHR-1967: Entity-scoped employees
-- Employee record = employment at an entity.
-- Same person at two entities = two employee rows.
-- ============================================

-- PHASE 1: Create default entities for orgs that have employees but no entities

INSERT INTO public.entities (organization_id, name)
SELECT DISTINCT e.organization_id, o.name
FROM public.employees e
JOIN public.organizations o ON e.organization_id = o.id
WHERE e.organization_id NOT IN (SELECT organization_id FROM public.entities);

-- PHASE 2: Add entity_id column (nullable initially for backfill)

ALTER TABLE public.employees
    ADD COLUMN entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE;

CREATE INDEX idx_employees_entity_id ON public.employees(entity_id);

-- PHASE 3: Backfill all existing employees with their org's first entity

UPDATE public.employees
SET entity_id = (
    SELECT id FROM public.entities
    WHERE organization_id = employees.organization_id
    ORDER BY created_at ASC
    LIMIT 1
);

-- PHASE 4: Make NOT NULL + change constraints

ALTER TABLE public.employees
    ALTER COLUMN entity_id SET NOT NULL;

ALTER TABLE public.employees
    DROP CONSTRAINT org_employees_organization_id_user_id_key;

ALTER TABLE public.employees
    ADD CONSTRAINT employees_entity_id_user_id_key UNIQUE (entity_id, user_id);

-- PHASE 5: Convert organization_id to child table pattern (trigger-populated)

ALTER TABLE public.employees
    ALTER COLUMN organization_id SET DEFAULT '';

CREATE TRIGGER trigger_set_org_id_employees
    BEFORE INSERT ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_entity();

-- PHASE 6: Drop rel__entity__employee (redundant — employee record IS the entity assignment)

DROP TABLE IF EXISTS public.rel__entity__employee CASCADE;

-- PHASE 7: Update realtime org-id resolver — remove rel__entity__employee case
-- (employees still uses direct organization_id column, no change needed for its own case)

CREATE OR REPLACE FUNCTION public.get_organization_id_for_change(
    p_table_name TEXT,
    p_record_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    org_id TEXT;
BEGIN
    CASE p_table_name
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        WHEN 'entities', 'admins', 'employees', 'departments',
             'contract_templates', 'contracts',
             'employee_columns', 'employee_column_choices', 'employee_views',
             'onboarding_invitations', 'files', 'admin_invitations' THEN
            org_id := p_record_data->>'organization_id';

        WHEN 'rel__department__employee' THEN
            SELECT d.organization_id INTO org_id
            FROM public.departments d
            WHERE d.id = p_record_data->>'department_id';

        WHEN 'rel__department__invitation' THEN
            SELECT oi.organization_id INTO org_id
            FROM public.onboarding_invitations oi
            WHERE oi.id = p_record_data->>'invitation_id';

        ELSE
            RAISE WARNING 'get_organization_id_for_change: unknown table %', p_table_name;
            RETURN NULL;
    END CASE;

    RETURN org_id;
END;
$$;
