-- ============================================
-- AHR-1954: PDF kind foundation
-- ============================================
-- Design intent (Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff,
-- "PDF contract templates - T1 Scoping" + "AHR-1954 Planning"):
--
--   * Adds contracts.signed_pdf_r2_path -- R2 object key for the burned signed
--     PDF (PDF-kind contracts only). Populated by the approve-contract edge
--     function on HR approval (T2 AHR-1957). NULL forever for tiptap-kind
--     contracts (which keep the existing client-side at-approve burn pipeline).
--
--   * Extends invitation + contract template_snapshot shape to include `type`
--     and `pdf_file_path` so PDF-kind rows are self-sufficient post-template-
--     hard-delete (matches AHR-1487 self-sufficiency invariant). Without this,
--     a template hard-deleted between send-invitation and HR approval cascade-
--     deletes the version row, leaving filler/burn unable to determine kind or
--     fetch the source PDF.
--
--   * Existing tiptap rows are backfilled in this migration so all rows share
--     a uniform shape going forward:
--       - invitations.template_snapshot: append {type:'tiptap', pdf_file_path:NULL}
--         to existing {layout, mandatory_field_keys, hr_field_keys, attachment_field_keys}
--       - contracts.template_snapshot: WRAP existing bare layout JSONB into
--         {type:'tiptap', layout:<existing>, pdf_file_path:NULL}. This diverges
--         from AHR-1491's bare-layout choice, which predated PDF kind.
--
--   * Versioning trigger and version-row INSERT are NOT touched -- the trigger
--     already hashes type || layout || pdf_file_path || mandatory_field_keys
--     || hr_field_keys || attachment_field_keys and copies all of those into
--     version rows (AHR-1791). The new layout shape for pdf kind goes through
--     the same JSONB column with no formula change.
-- ============================================

-- PHASE 1: New burned-PDF path column on contracts
ALTER TABLE public.contracts
    ADD COLUMN signed_pdf_r2_path TEXT;

COMMENT ON COLUMN public.contracts.signed_pdf_r2_path IS
    'R2 object key for the burned signed PDF (PDF-kind contracts only). Populated by employee-onboarding_approve-contract on HR approval; NULL for tiptap-kind contracts and for unapproved PDF-kind contracts. See AHR-1487 / AHR-1953 / AHR-1954.';

-- PHASE 2: Backfill onboarding_invitations.template_snapshot
-- Adds type='tiptap' and pdf_file_path=NULL to existing rows. The presence of
-- a top-level 'type' key is the marker for "already extended" -- skip those.
-- jsonb concat (`||`) preserves all existing keys and overwrites nothing.
UPDATE public.onboarding_invitations
   SET template_snapshot = template_snapshot
       || jsonb_build_object('type', 'tiptap', 'pdf_file_path', NULL)
 WHERE template_snapshot IS NOT NULL
   AND NOT (template_snapshot ? 'type');

-- PHASE 3: Backfill contracts.template_snapshot
-- Wrap the existing bare layout JSONB into {type, layout, pdf_file_path}. The
-- absence of a top-level 'layout' key is the marker for "still bare" -- a
-- pre-AHR-1954 row (bare ProseMirror doc) has top-level 'type' = 'doc' but no
-- 'layout' key, while a post-migration row always carries 'layout' as a wrapper
-- key. We use this disambiguator instead of the 'type' key because 'type' would
-- collide with ProseMirror's own root-level 'type' field.
UPDATE public.contracts
   SET template_snapshot = jsonb_build_object(
           'type', 'tiptap',
           'layout', template_snapshot,
           'pdf_file_path', NULL
       )
 WHERE template_snapshot IS NOT NULL
   AND NOT (template_snapshot ? 'layout');

-- PHASE 4: Document the new snapshot shapes
COMMENT ON COLUMN public.onboarding_invitations.template_snapshot IS
    'Self-contained snapshot of the pinned contract_template_versions row, captured at send-invitation time. Shape: {type: ''tiptap''|''pdf'', layout: <kind-specific JSONB>, pdf_file_path: TEXT|NULL, mandatory_field_keys: TEXT[], hr_field_keys: TEXT[], attachment_field_keys: TEXT[]}. For tiptap kind, layout is the ProseMirror doc and pdf_file_path is NULL. For pdf kind, layout is an array of positioned fields [{key, page, x_pct, y_pct, w_pct, h_pct, type}] and pdf_file_path points to the source PDF in R2. Snapshot is the authoritative render and validation source for the invitee -- template edits and template hard-delete cannot mutate it. See AHR-1487 / AHR-1490 / AHR-1791 / AHR-1954.';

COMMENT ON COLUMN public.contracts.template_snapshot IS
    'Self-contained snapshot copied from invitation.template_snapshot at submit-contract time. Shape: {type: ''tiptap''|''pdf'', layout: <kind-specific JSONB>, pdf_file_path: TEXT|NULL}. For tiptap kind, layout is the ProseMirror doc and pdf_file_path is NULL; render path is client-side. For pdf kind, layout is an array of positioned fields and pdf_file_path is the source PDF in R2; render and burn paths read from this snapshot, so signed contracts remain renderable and burnable even if the source template / version is later hard-deleted. See AHR-1487 / AHR-1491 / AHR-1954.';
