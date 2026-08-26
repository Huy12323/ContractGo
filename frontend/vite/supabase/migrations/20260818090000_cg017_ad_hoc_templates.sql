-- ============================================
-- CG-017 — ad-hoc (one-off) contract templates
--
-- Motivation: the composer can now send a document that was UPLOADED during
-- composition rather than picked from the library. The send/sign pipeline takes
-- the source PDF, its evidence digest and the field snapshot from a template
-- VERSION (`resolveTemplateAndVersion` → `hashSourcePdf` → `buildSnapshot`), so
-- the cheapest correct home for an uploaded document is a real template row —
-- it inherits versioning, the immutable version trigger and the whole evidence
-- chain for free, and no edge function changes.
--
-- What it must NOT inherit is a place in the library. A one-off upload is not a
-- reusable template, and listing it would turn the Templates page into a pile of
-- single-use documents. Hence one flag, checked in exactly one query.
-- ============================================

-- PHASE 1: ADD COLUMN
-- NOT NULL DEFAULT false: every existing row keeps appearing in the library, so
-- there is no backfill and no data migration. The column is written once, at
-- INSERT, and never updated — a library template does not become a one-off, and
-- a one-off does not get promoted.
ALTER TABLE public.contract_templates
    ADD COLUMN IF NOT EXISTS is_ad_hoc BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contract_templates.is_ad_hoc IS
    'True for a document uploaded during envelope composition rather than authored in the library. Hidden from template listings; otherwise an ordinary template, including versioning. Immutable after insert. NOT a security boundary — see the RLS note in CG-017.';

-- PHASE 2: THE UNIQUE NAME CONSTRAINT MUST BECOME PARTIAL.
--
-- `contract_templates_unique_name_per_entity UNIQUE (entity_id, name)` is a real
-- hazard for this feature: an ad-hoc row is named from the uploaded FILENAME, so
-- a sender uploading `NDA.pdf` into an entity that already has a template called
-- "NDA" would hit a 23505 in a flow where they never typed a name and have no
-- way to resolve the collision.
--
-- The library keeps its namespace guarantee. One-offs are exempt because they
-- are never named by a human and never listed, so a duplicate name among them
-- cannot confuse anyone.
ALTER TABLE public.contract_templates
    DROP CONSTRAINT contract_templates_unique_name_per_entity;

CREATE UNIQUE INDEX contract_templates_unique_name_per_entity
    ON public.contract_templates (entity_id, name)
    WHERE is_ad_hoc = false;

-- PHASE 3: LISTING INDEX, mirroring the shape AHR-945 used for is_archived.
CREATE INDEX IF NOT EXISTS idx_contract_templates_entity_listable
    ON public.contract_templates (entity_id, is_archived)
    WHERE is_archived = false AND is_ad_hoc = false;

-- PHASE 4: RLS — DELIBERATELY UNCHANGED.
--
-- `is_ad_hoc` is a LISTING concern, not an access boundary, and it must not
-- become one. The composer reads its own ad-hoc template back by id (for layout,
-- roles and pdf_file_path across the remaining steps), `files_r2_upload-start`
-- resolves organization_id off the row, and the version trigger writes against
-- it. Adding `AND is_ad_hoc = false` to
-- `admin_or_owner_can_view_contract_templates` would break the very flow this
-- migration exists to enable.
--
-- Hiding happens in exactly one place: the `.eq("is_ad_hoc", false)` filter in
-- `useQ_Tables_Templates`.
--
-- Also deliberately absent: `is_ad_hoc` is NOT added to
-- `write_contract_template_version()`'s `content_hash`. That hash is exactly the
-- set of CONTENT columns (CG-013 phase 5), and this is immutable row identity —
-- it could never change the dedup outcome, and adding it would make the next
-- person think mutable non-content columns belong there too. The column is not
-- added to `contract_template_versions` either: a pinned version never needs to
-- answer "was this ad-hoc".
