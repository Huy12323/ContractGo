-- ============================================
-- AHR-1640: Add hr_field_keys JSONB on contract_templates + versions
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * Third field state: in addition to "mandatory" (must be filled to submit)
--     and implicit "optional", a field can be "HR" — HR pre-fills it during
--     the contract-filler pre-fill step and the employee sees it read-only
--     with value visible. Enforced in the composer as a third-way-exclusive
--     choice (HR XOR mandatory XOR optional).
--
--   * Mirrors the mandatory_field_keys pattern from AHR-1173 / AHR-1490
--     exactly: column on contract_templates + contract_template_versions,
--     included in the versioning trigger's hash + INSERT list, and carried
--     through the invitation snapshot alongside mandatory_field_keys.
--
--   * Contract snapshots (contracts.template_snapshot) stay bare layout per
--     AHR-1491 — signed contracts are post-sign render only and don't carry
--     validation/lock metadata.
--
--   * PHASE 4 recomputes v1 content_hash with the new formula (adds
--     hr_field_keys). Same pattern AHR-1490 used when it added
--     mandatory_field_keys to the hash.
-- ============================================

-- PHASE 1: contract_templates.hr_field_keys
ALTER TABLE public.contract_templates
    ADD COLUMN hr_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PHASE 2: contract_template_versions.hr_field_keys
ALTER TABLE public.contract_template_versions
    ADD COLUMN hr_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- PHASE 3: Backfill existing v1 rows from parent templates
UPDATE public.contract_template_versions v
   SET hr_field_keys = COALESCE(t.hr_field_keys, '[]'::jsonb)
  FROM public.contract_templates t
 WHERE v.template_id = t.id
   AND v.version_number = 1;

-- PHASE 4: Recompute v1 content_hash with the new (hr_field_keys-inclusive) formula
UPDATE public.contract_template_versions
   SET content_hash = encode(
           digest(
               type::text || layout::text
                   || coalesce(pdf_file_path, '')
                   || coalesce(mandatory_field_keys::text, '')
                   || coalesce(hr_field_keys::text, ''),
               'sha256'
           ),
           'hex'
       )
 WHERE version_number = 1;

-- PHASE 5: Update trigger function with new hash formula + INSERT column
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
                || coalesce(NEW.hr_field_keys::text, ''),
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
        type, layout, pdf_file_path, mandatory_field_keys, hr_field_keys,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.mandatory_field_keys, NEW.hr_field_keys,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;

-- PHASE 6: Backfill existing invitation snapshots to include hr_field_keys: []
-- Uniform snapshot shape across old and new invitations so consumer code
-- can read snapshot.hr_field_keys without conditional fallbacks. Safe because
-- this migration is the first writer of hr_field_keys into any snapshot.
UPDATE public.onboarding_invitations
   SET template_snapshot = template_snapshot || jsonb_build_object('hr_field_keys', '[]'::jsonb);
