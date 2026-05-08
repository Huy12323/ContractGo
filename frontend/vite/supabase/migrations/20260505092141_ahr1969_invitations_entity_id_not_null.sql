-- ============================================
-- AHR-1969: Revert entity_id to NOT NULL on onboarding_invitations
-- Backfill existing NULL values to org's first entity.
-- ============================================

-- Safety net: create default entities for orgs that have invitations but no entities
INSERT INTO public.entities (organization_id, name)
SELECT DISTINCT oi.organization_id, o.name
FROM public.onboarding_invitations oi
JOIN public.organizations o ON oi.organization_id = o.id
WHERE oi.entity_id IS NULL
  AND oi.organization_id NOT IN (SELECT organization_id FROM public.entities);

UPDATE public.onboarding_invitations
SET entity_id = (
    SELECT id FROM public.entities
    WHERE organization_id = onboarding_invitations.organization_id
    ORDER BY created_at ASC
    LIMIT 1
)
WHERE entity_id IS NULL;

ALTER TABLE public.onboarding_invitations
    ALTER COLUMN entity_id SET NOT NULL;
