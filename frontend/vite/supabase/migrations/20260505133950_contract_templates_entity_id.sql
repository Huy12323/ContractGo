-- ============================================
-- Contract templates: add entity_id
-- Templates become entity-scoped so each entity
-- has its own set of contract templates.
-- ============================================

-- Safety net: create default entities for orgs that have templates but no entities
INSERT INTO public.entities (organization_id, name)
SELECT DISTINCT ct.organization_id, o.name
FROM public.contract_templates ct
JOIN public.organizations o ON ct.organization_id = o.id
WHERE ct.organization_id NOT IN (SELECT organization_id FROM public.entities);

ALTER TABLE public.contract_templates
    ADD COLUMN entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE;

CREATE INDEX idx_contract_templates_entity_id ON public.contract_templates(entity_id);

UPDATE public.contract_templates
SET entity_id = (
    SELECT id FROM public.entities
    WHERE organization_id = contract_templates.organization_id
    ORDER BY created_at ASC
    LIMIT 1
);

ALTER TABLE public.contract_templates
    ALTER COLUMN entity_id SET NOT NULL;

ALTER TABLE public.contract_templates
    ALTER COLUMN organization_id SET DEFAULT '';

CREATE TRIGGER trigger_set_org_id_contract_templates
    BEFORE INSERT ON public.contract_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_entity();
