-- ============================================
-- AHR-1488: Contract template versioning foundation
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * contract_template_versions is an immutable audit trail — one row per save.
--     Write path is a SECURITY DEFINER trigger (added in T2 AHR-1489); no
--     INSERT/UPDATE/DELETE RLS policies are granted here, so direct client
--     writes are blocked.
--
--   * Templates can be hard-deleted. The existing
--     admin_or_owner_can_delete_contract_templates policy stays as-is — no
--     conditional DELETE logic, no FK RESTRICT.
--
--   * Invitations and contracts will carry their own template_snapshot JSONB
--     (added in T2 AHR-1490 / AHR-1491) as the authoritative render source.
--     Because snapshots make those rows self-contained, FKs pointing back to
--     contract_templates / contract_template_versions can SET NULL safely when
--     their parent is deleted.
--
--   * This migration fixes the original bug by swapping
--     onboarding_invitations.contract_template_id from ON DELETE CASCADE to
--     ON DELETE SET NULL. Editing a template no longer mutates live invitations
--     (that is solved by snapshots in AHR-1490), and deleting a template no
--     longer destroys them.
--
--   * Archive (is_archived, AHR-945) remains the default HR UX for retiring
--     in-use templates. Hard-delete is for cleanup of never-used templates and
--     for org-wide cascade deletion.
-- ============================================

-- PHASE 1: Type enum
CREATE TYPE public.contract_template_type_enum AS ENUM ('tiptap', 'pdf');

-- PHASE 2: Add type + pdf_file_path to contract_templates
ALTER TABLE public.contract_templates
    ADD COLUMN type public.contract_template_type_enum NOT NULL DEFAULT 'tiptap',
    ADD COLUMN pdf_file_path TEXT;

-- PHASE 3: Create contract_template_versions table
CREATE TABLE public.contract_template_versions (
    id TEXT PRIMARY KEY DEFAULT generate_id('ctv'),
    template_id TEXT NOT NULL REFERENCES public.contract_templates(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    type public.contract_template_type_enum NOT NULL,
    layout JSONB NOT NULL DEFAULT '{}',
    pdf_file_path TEXT,
    content_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT contract_template_versions_unique_version_per_template UNIQUE (template_id, version_number)
);

CREATE INDEX idx_contract_template_versions_template_id ON public.contract_template_versions(template_id);
CREATE INDEX idx_contract_template_versions_organization_id ON public.contract_template_versions(organization_id);

-- PHASE 4: RLS — admin_or_owner SELECT only
-- Immutability is enforced by the absence of INSERT/UPDATE/DELETE policies.
-- The write trigger added in AHR-1489 runs as SECURITY DEFINER and bypasses RLS.
ALTER TABLE public.contract_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_contract_template_versions"
    ON public.contract_template_versions FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- PHASE 5: Backfill one v1 row per existing template.
-- Runs before the trigger exists (AHR-1489), so no double-write. content_hash
-- formula matches the one the trigger will use:
-- sha256(layout::text || coalesce(pdf_file_path, '')). created_by = NULL for
-- historical rows (no clear author).
INSERT INTO public.contract_template_versions (
    template_id, organization_id, version_number, type, layout, pdf_file_path, content_hash, created_by
)
SELECT
    id,
    organization_id,
    1,
    type,
    layout,
    pdf_file_path,
    encode(digest(layout::text || coalesce(pdf_file_path, ''), 'sha256'), 'hex'),
    NULL
FROM public.contract_templates;

-- PHASE 6: Swap onboarding_invitations.contract_template_id FK to SET NULL
-- and make the column nullable. This is the core bug fix — deleting a template
-- no longer destroys live invitations (their template_snapshot, added in
-- AHR-1490, will keep them renderable).
ALTER TABLE public.onboarding_invitations
    DROP CONSTRAINT onboarding_invitations_contract_template_id_fkey;

ALTER TABLE public.onboarding_invitations
    ALTER COLUMN contract_template_id DROP NOT NULL;

ALTER TABLE public.onboarding_invitations
    ADD CONSTRAINT onboarding_invitations_contract_template_id_fkey
    FOREIGN KEY (contract_template_id)
    REFERENCES public.contract_templates(id)
    ON DELETE SET NULL;

-- PHASE 7: Table comments for discoverability
COMMENT ON TABLE public.contract_templates IS
    'Contract templates for onboarding invitations. Lifecycle: archive (is_archived) is the default HR UX for retiring in-use templates; hard-delete is permitted via admin_or_owner_can_delete_contract_templates RLS for cleanup of never-used templates and org-wide cascade. Template edits do not affect live invitations/contracts — those carry their own template_snapshot JSONB (see AHR-1490/AHR-1491) and contract_template_version_id pointer. See AHR-1487.';

COMMENT ON TABLE public.contract_template_versions IS
    'Immutable audit trail — one row per contract_templates save. Written only by the SECURITY DEFINER trigger from AHR-1489; no INSERT/UPDATE/DELETE RLS policies are granted. Rows cascade-delete when their parent template is deleted. Consumers (invitations, contracts) render from their own template_snapshot column; this table is for audit/history only. See AHR-1487.';
