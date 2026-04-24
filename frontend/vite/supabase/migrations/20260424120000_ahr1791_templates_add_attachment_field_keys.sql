-- ============================================
-- AHR-1791: Add attachment_field_keys JSONB on contract_templates + versions
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * File-type fields are lifted out of the TipTap layout and live as a
--     separate list on the template. Form builder renders an "Attachments"
--     panel above the body; file fieldInput nodes no longer exist inside the
--     document tree. Same storage pattern as mandatory_field_keys and
--     hr_field_keys: JSONB array of employee_column ids (or universal field
--     keys).
--
--   * Node backfill (scripts/backfill-ahr1791-attachment-field-keys.js) runs
--     AFTER this migration and walks every existing template + version layout,
--     extracting file-type fieldInput fieldKeys into this column and stripping
--     those nodes from the layout tree. The script uses
--     SET session_replication_role = replica to suppress the versioning trigger
--     while updating contract_templates (avoids spurious v2 rows).
--
--   * Existing onboarding_invitations.template_snapshot rows are NOT backfilled
--     (deliberate — their layouts are frozen audit records). Consumers fall
--     back to extractFields(layout) filtered to file-type when
--     snapshot.attachment_field_keys is absent.
--
--   * PHASE 3 updates the versioning trigger's content_hash + INSERT list to
--     include attachment_field_keys. Going-forward only — existing v1 rows
--     don't need re-hashing here because the Node backfill rewrites their
--     layout + attachment_field_keys + content_hash together.
-- ============================================

-- PHASE 1: contract_templates.attachment_field_keys
ALTER TABLE public.contract_templates
    ADD COLUMN attachment_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PHASE 2: contract_template_versions.attachment_field_keys
ALTER TABLE public.contract_template_versions
    ADD COLUMN attachment_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PHASE 3: Update trigger function with new hash formula + INSERT column
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
    v_new_hash := encode(
        digest(
            NEW.type::text || NEW.layout::text
                || coalesce(NEW.pdf_file_path, '')
                || coalesce(NEW.mandatory_field_keys::text, '')
                || coalesce(NEW.hr_field_keys::text, '')
                || coalesce(NEW.attachment_field_keys::text, ''),
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

    -- No prior versions (INSERT case): start at 1
    v_next_version := COALESCE(v_next_version, 1);

    INSERT INTO public.contract_template_versions (
        template_id, organization_id, version_number,
        type, layout, pdf_file_path, mandatory_field_keys, hr_field_keys, attachment_field_keys,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.mandatory_field_keys, NEW.hr_field_keys, NEW.attachment_field_keys,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;
