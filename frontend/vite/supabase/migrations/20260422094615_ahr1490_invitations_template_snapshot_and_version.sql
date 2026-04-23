-- ============================================
-- AHR-1490 (Phase B): onboarding_invitations snapshot + version pin
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * template_snapshot JSONB — authoritative render source. Structured as
--     { layout, mandatory_field_keys } so invitations remain fully renderable
--     and validatable even if the source template + all versions are later
--     hard-deleted.
--
--   * contract_template_version_id FK — provenance pointer to the pinned
--     version row. ON DELETE SET NULL so template hard-delete (which cascades
--     versions) leaves the invitation intact; the snapshot keeps rendering.
--
--   * Phase 1 adds both columns nullable (template_snapshot defaulted to '{}'
--     for the brief pre-backfill window); Phase 2 backfills; Phase 3 flips
--     contract_template_version_id to NOT NULL now that every row has one.
-- ============================================

-- PHASE 1: Add both columns (version_id nullable pre-backfill)
ALTER TABLE public.onboarding_invitations
    ADD COLUMN template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN contract_template_version_id TEXT
        REFERENCES public.contract_template_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_onboarding_invitations_contract_template_version_id
    ON public.onboarding_invitations(contract_template_version_id);

-- PHASE 2: Backfill both from parent template's v1
UPDATE public.onboarding_invitations i
   SET template_snapshot = jsonb_build_object(
           'layout', t.layout,
           'mandatory_field_keys', COALESCE(t.mandatory_field_keys, '[]'::jsonb)
       ),
       contract_template_version_id = v.id
  FROM public.contract_templates t
  JOIN public.contract_template_versions v
       ON v.template_id = t.id AND v.version_number = 1
 WHERE i.contract_template_id = t.id;

-- PHASE 3: Enforce NOT NULL on version pin now that backfill is complete
ALTER TABLE public.onboarding_invitations
    ALTER COLUMN contract_template_version_id SET NOT NULL;
