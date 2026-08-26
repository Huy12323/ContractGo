-- ============================================
-- CG-039: TEMPLATE PDFs KEEP THEIR FK POPULATED
-- ============================================
-- CG-037 gave `contract_templates` and `contract_template_versions` a
-- `pdf_file_id`, backfilled it, and then deliberately gave them no trigger — the
-- reasoning being that their writers are ordinary client mutations that already
-- hold a `files.id`, since `useM_Files_Upload` returns one.
--
-- That reasoning was wrong in one specific way, and it leaves a hole rather than
-- an inconvenience. `useM_Template_UploadPdf` returns a KEY, and the mutations
-- behind it (`useM_Template_SaveLayout`, `_Create`, `_Restore`, `_Update`) all
-- write `pdf_file_path`. So under CG-037 as shipped, every template saved from
-- today forward would set the key and leave `pdf_file_id` NULL — the two columns
-- drifting apart, which is the exact failure the whole change set exists to make
-- impossible. Worse, `contract_templates` had no CHECK to catch it, so it would
-- have drifted silently.
--
-- There were two ways to close it: thread the file id through four client hooks
-- and a modal, or derive it in the database the way the evidence tables already
-- do. This file takes the second, for the reason CG-037 gave for the evidence
-- tables and which applies just as well here — one definition, and no callsite
-- can forget it. The versioning trigger has to learn about the column either way,
-- and that is server-side regardless.
--
-- CONSEQUENCE WORTH KNOWING: the client needs no change at all for templates.
-- `pdf_file_path` remains the input; `pdf_file_id` is derived from it. When the
-- later migration drops `pdf_file_path`, THAT is when the hooks change — and at
-- that point the trigger below is deleted rather than adapted.

-- --------------------------------------------
-- PHASE 1: DERIVE ON WRITE
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.set_contract_template_file_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- `contract_templates` has no `created_by`, so the uploader is left unset for
    -- a key whose `files` row does not already exist. In practice it always does:
    -- the row is created by `useM_Files_Upload` before the template is saved, and
    -- `files_ensure` finds it. See the matching note in CG-037's backfill.
    NEW.pdf_file_id := public.files_ensure(
        NEW.pdf_file_path, NEW.organization_id, NULL, 'application/pdf');
    RETURN NEW;
END;
$$;

-- BEFORE, so it writes NEW in place rather than issuing a second UPDATE that
-- would re-fire both the realtime trigger and the versioning trigger — the second
-- of which would cut a spurious version row on every save.
CREATE TRIGGER on_contract_templates_set_file_id
    BEFORE INSERT OR UPDATE OF pdf_file_path ON public.contract_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_contract_template_file_id();

REVOKE EXECUTE ON FUNCTION public.set_contract_template_file_id() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------
-- PHASE 2: VERSIONS INHERIT IT
-- --------------------------------------------
-- `write_contract_template_version` snapshots the template's columns into a
-- version row. It has to carry `pdf_file_id` across, or every version cut from
-- today forward has a NULL FK beside a populated key — the same drift, one table
-- over.
--
-- Reproduced verbatim from the live definition (CG-017's) with two lines added,
-- and in particular the CONTENT HASH IS UNCHANGED. `pdf_file_id` is derived from
-- `pdf_file_path`, which the hash already covers, so including it would add
-- nothing while breaking dedup against every version row already stored — every
-- template would cut one spurious version on its next save.
CREATE OR REPLACE FUNCTION public.write_contract_template_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_new_hash TEXT;
    v_last_hash TEXT;
    v_next_version INTEGER;
BEGIN
    -- Field definitions live inside `layout` (CG-001), so the hash covers the
    -- layout plus the role set — and, as of CG-013, the sending defaults.
    v_new_hash := encode(
        digest(
            NEW.type::text || NEW.layout::text
                || coalesce(NEW.pdf_file_path, '')
                || coalesce(NEW.signer_roles::text, '')
                || coalesce(NEW.default_expiry_days::text, '')
                || coalesce(NEW.default_reminder_days::text, ''),
            'sha256'
        ),
        'hex'
    );

    SELECT content_hash, version_number + 1
      INTO v_last_hash, v_next_version
      FROM public.contract_template_versions
     WHERE template_id = NEW.id
     ORDER BY version_number DESC
     LIMIT 1;

    -- Dedup: content unchanged → no new row
    IF v_last_hash IS NOT NULL AND v_last_hash = v_new_hash THEN
        RETURN NEW;
    END IF;

    v_next_version := COALESCE(v_next_version, 1);

    INSERT INTO public.contract_template_versions (
        template_id, organization_id, version_number,
        type, layout, pdf_file_path, pdf_file_id, signer_roles,
        default_expiry_days, default_reminder_days,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.pdf_file_id, NEW.signer_roles,
        NEW.default_expiry_days, NEW.default_reminder_days,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;

-- CG-010: CREATE OR REPLACE resets the ACL.
REVOKE EXECUTE ON FUNCTION public.write_contract_template_version() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------
-- PHASE 3: MAKE THE DRIFT IMPOSSIBLE
-- --------------------------------------------
-- The constraints CG-037 gave the evidence tables and did not give these two.
-- They are what turns "the trigger keeps these in step" from a claim into a
-- guarantee, and what would have caught CG-037's gap at the moment it shipped
-- rather than the first time somebody wondered why a template had no file row.
ALTER TABLE public.contract_templates
    ADD CONSTRAINT contract_templates_file_matches_key CHECK (
        (pdf_file_path IS NULL) = (pdf_file_id IS NULL)
    );

ALTER TABLE public.contract_template_versions
    ADD CONSTRAINT contract_template_versions_file_matches_key CHECK (
        (pdf_file_path IS NULL) = (pdf_file_id IS NULL)
    );

-- --------------------------------------------
-- VERIFY
-- --------------------------------------------
DO $$
DECLARE
    v_bad BIGINT;
BEGIN
    SELECT count(*) INTO v_bad FROM public.contract_templates
     WHERE (pdf_file_path IS NULL) <> (pdf_file_id IS NULL);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'CG-039 incomplete — % contract_templates rows drifted', v_bad;
    END IF;

    SELECT count(*) INTO v_bad FROM public.contract_template_versions
     WHERE (pdf_file_path IS NULL) <> (pdf_file_id IS NULL);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'CG-039 incomplete — % contract_template_versions rows drifted', v_bad;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'on_contract_templates_set_file_id' AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'CG-039 incomplete — template file-id trigger missing';
    END IF;
END $$;
