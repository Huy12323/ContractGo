-- ============================================
-- AHR-1491: Contracts pin to template version
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * Column rename: contracts.form_snapshot → contracts.template_snapshot.
--     Value shape unchanged (bare JSONB layout). Signed contracts are read
--     post-sign for rendering only; they don't carry validation metadata
--     (that lived on the invitation snapshot).
--
--   * New NULLABLE FK contracts.contract_template_version_id → versions.
--     ON DELETE SET NULL so template hard-delete cleanly nulls the FK while
--     the snapshot keeps rendering. Nullable from the start to avoid the
--     same "NOT NULL vs SET NULL" conflict that surfaced in AHR-1490.
--
--   * Backfill: primary via invitation.contract_template_version_id; fallback
--     via contract_templates v1 for contracts with NULL invitation_id.
--
--   * PHASE 6 hotfixes AHR-1490 — relaxes
--     onboarding_invitations.contract_template_version_id to NULLABLE so
--     template hard-delete actually works (NOT NULL + ON DELETE SET NULL was
--     contradictory, blocking cascade deletes mid-transaction).
-- ============================================

-- PHASE 1: Rename column
ALTER TABLE public.contracts RENAME COLUMN form_snapshot TO template_snapshot;

-- PHASE 2: New FK to versions (NULLABLE, SET NULL on parent delete)
ALTER TABLE public.contracts
    ADD COLUMN contract_template_version_id TEXT
        REFERENCES public.contract_template_versions(id) ON DELETE SET NULL;

-- PHASE 3: Index
CREATE INDEX idx_contracts_contract_template_version_id
    ON public.contracts(contract_template_version_id);

-- PHASE 4: Backfill — primary path via invitation
UPDATE public.contracts c
   SET contract_template_version_id = i.contract_template_version_id
  FROM public.onboarding_invitations i
 WHERE c.invitation_id = i.id
   AND i.contract_template_version_id IS NOT NULL;

-- PHASE 5: Backfill — fallback for contracts with NULL invitation_id
UPDATE public.contracts c
   SET contract_template_version_id = v.id
  FROM public.contract_template_versions v
 WHERE c.invitation_id IS NULL
   AND c.contract_template_id IS NOT NULL
   AND v.template_id = c.contract_template_id
   AND v.version_number = 1;

-- PHASE 6: AHR-1490 hotfix — relax invitation version FK to NULLABLE
-- so ON DELETE SET NULL on cascade doesn't violate NOT NULL.
ALTER TABLE public.onboarding_invitations
    ALTER COLUMN contract_template_version_id DROP NOT NULL;

-- PHASE 7: Document the snapshot-authoritative model on contracts
COMMENT ON TABLE public.contracts IS
    'Signed and in-flight contracts. Renders from template_snapshot JSONB (bare layout) which is captured at submit time; template edits cannot mutate it. contract_template_version_id is a provenance pointer (FK to contract_template_versions, ON DELETE SET NULL) — the snapshot is self-sufficient for rendering even if the pinned version or its parent template is later hard-deleted. See AHR-1487 / AHR-1491.';
