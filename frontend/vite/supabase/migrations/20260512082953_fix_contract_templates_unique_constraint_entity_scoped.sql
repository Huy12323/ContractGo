-- ============================================
-- Fix unique constraint: scope to entity_id instead of organization_id
-- ============================================

ALTER TABLE public.contract_templates
    DROP CONSTRAINT contract_templates_unique_name_per_org;

ALTER TABLE public.contract_templates
    ADD CONSTRAINT contract_templates_unique_name_per_entity UNIQUE (entity_id, name);
