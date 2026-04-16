-- ============================================
-- AHR-945 — contract_templates soft delete via is_archived
-- Motivation: onboarding_invitations FK-references contract_templates(id);
-- hard delete would orphan invitations and break the filler page.
-- Soft delete via is_archived preserves the row and lets active-only queries
-- filter with `.eq('is_archived', false)`.
-- ============================================

-- PHASE 1: ADD COLUMN
ALTER TABLE public.contract_templates
    ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;

-- PHASE 2: PARTIAL INDEX for the common active-templates lookup
CREATE INDEX idx_contract_templates_active
    ON public.contract_templates(organization_id, is_archived)
    WHERE is_archived = false;
