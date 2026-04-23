-- ============================================
-- AHR-1490 (Phase A): mandatory_field_keys in contract_template_versions
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * Required-field lists are versionable content — toggling whether a field
--     is mandatory is a real content change that should be captured in the
--     audit trail.
--
--   * Extends the versions table + trigger from AHR-1488/1489 so the invitation
--     snapshot (added in Phase B) can be fully self-contained without splitting
--     validation metadata across columns.
--
--   * Column type matches contract_templates.mandatory_field_keys — JSONB
--     (defined as a string[] array by TS override; stored canonically by
--     Postgres so hashing the text form is deterministic).
--
--   * PHASE 3 recomputes v1 content_hash with the new formula (adds
--     mandatory_field_keys). Same pattern AHR-1489 used when it added `type`.
-- ============================================

-- PHASE 1: Add column with safe default (empty array)
ALTER TABLE public.contract_template_versions
    ADD COLUMN mandatory_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PHASE 2: Backfill existing v1 rows from parent templates
UPDATE public.contract_template_versions v
   SET mandatory_field_keys = COALESCE(t.mandatory_field_keys, '[]'::jsonb)
  FROM public.contract_templates t
 WHERE v.template_id = t.id
   AND v.version_number = 1;

-- PHASE 3: Recompute v1 content_hash with the new (mandatory_field_keys-inclusive) formula
UPDATE public.contract_template_versions
   SET content_hash = encode(
           digest(
               type::text || layout::text
                   || coalesce(pdf_file_path, '')
                   || coalesce(mandatory_field_keys::text, ''),
               'sha256'
           ),
           'hex'
       )
 WHERE version_number = 1;

-- PHASE 4: Update trigger function with new hash formula + INSERT column
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
                || coalesce(NEW.mandatory_field_keys::text, ''),
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
        type, layout, pdf_file_path, mandatory_field_keys,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.mandatory_field_keys,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;
