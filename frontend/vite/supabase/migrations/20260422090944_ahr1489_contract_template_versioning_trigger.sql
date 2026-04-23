-- ============================================
-- AHR-1489: Contract template versioning trigger
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * Trigger on contract_templates AFTER INSERT OR UPDATE writes an immutable
--     row to contract_template_versions on every save.
--
--   * No-op dedup via content_hash comparison — saving identical content twice
--     does NOT produce duplicate version rows.
--
--   * content_hash formula: sha256(type || layout || pdf_file_path). Including
--     type captures future tiptap↔pdf switches as version boundaries.
--
--   * PHASE 1 recomputes AHR-1488's backfilled v1 hashes with this formula so
--     dedup is consistent from row one. Without this, the first no-op save on
--     any existing template would mismatch v1 and spuriously write v2.
--
--   * Function is SECURITY DEFINER — bypasses the INSERT-policy-less RLS on
--     contract_template_versions (from AHR-1488). created_by = auth.uid()
--     (NULL for service-role / psql / backfill contexts).
--
--   * UNIQUE (template_id, version_number) from AHR-1488 is the concurrency
--     guard — concurrent UPDATEs on the same template produce unique-violation;
--     the later transaction rolls back and the caller retries. Acceptable at
--     this scale; no advisory locking needed.
-- ============================================

-- PHASE 1: Recompute v1 backfill hashes with the type-inclusive formula
UPDATE public.contract_template_versions
   SET content_hash = encode(
           digest(type::text || layout::text || coalesce(pdf_file_path, ''), 'sha256'),
           'hex'
       )
 WHERE version_number = 1;

-- PHASE 2: Trigger function
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
        digest(NEW.type::text || NEW.layout::text || coalesce(NEW.pdf_file_path, ''), 'sha256'),
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
        template_id, organization_id, version_number, type, layout, pdf_file_path, content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version, NEW.type, NEW.layout, NEW.pdf_file_path, v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;

-- PHASE 3: Trigger wiring
CREATE TRIGGER trigger_write_contract_template_version
    AFTER INSERT OR UPDATE ON public.contract_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.write_contract_template_version();
