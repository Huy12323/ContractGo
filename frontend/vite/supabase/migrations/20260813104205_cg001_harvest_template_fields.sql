-- ============================================
-- CG-001: HARVEST TEMPLATE FIELDS (ContractGo layout v2)
-- ============================================
--
-- Context:
--   Positioned fields in `contract_templates.layout` currently store bare keys
--   (`col_*` employee_column ids, or one of four universal keys) and resolve
--   their label / type / options by LOOKUP at render time — in the filler, the
--   builder, the versions modal and the burn pipeline. Who-fills-what is
--   encoded as three parallel jsonb key arrays (mandatory / hr / attachment),
--   which conflates "who fills it" with "is it required".
--
--   ContractGo drops `employee_columns` entirely. Running that drop before this
--   migration would silently destroy every template's field labels, types and
--   choice options — the damage invisible until someone opens the builder.
--   THIS MIGRATION MUST THEREFORE RUN BEFORE ANY HR TABLE IS DROPPED.
--
-- What this does:
--   * Adds `signer_roles` to templates + versions.
--   * Rewrites array-kind (`pdf`) layouts to SELF-DESCRIBING v2 entries that
--     inline label / type / options and carry `role_id` + `required` as two
--     orthogonal axes.
--   * Applies the same transform to the `template_snapshot` payloads on
--     `onboarding_invitations` and `contracts`, preserving the AHR-1487/1490/1954
--     self-sufficiency invariant (a sent document must still render after its
--     template is hard-deleted).
--   * Records every old-key -> new-field-id mapping in `_cg_field_key_map` so
--     the transform is auditable and reversible.
--   * Drops the three `*_field_keys` columns and rewrites the versioning trigger.
--
-- Deliberately NOT done here:
--   * `employee_columns` and friends are NOT dropped — that is the strip
--     migration, which must come after this one.
--   * `tiptap` layouts (jsonb OBJECT, a ProseMirror doc) are left untouched.
--     The kind is being retired; its key arrays are archived into
--     `_cg_field_key_map` rather than silently discarded.
-- ============================================

-- ---------------------------------------------------------------------------
-- PHASE 1: SCHEMA — signer roles
-- ---------------------------------------------------------------------------

ALTER TABLE public.contract_templates
    ADD COLUMN IF NOT EXISTS signer_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contract_template_versions
    ADD COLUMN IF NOT EXISTS signer_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contract_templates.signer_roles IS
    'ContractGo v2. Ordered signer roles this template expects: [{id, name, order, color}]. '
    'Positioned fields in `layout` reference these via `role_id`. Two seed roles are created '
    'by CG-001: rol_sender (fields the sending org pre-fills) and rol_signer (fields the '
    'counterparty fills). Snapshotted alongside `layout` so a sent envelope stays renderable '
    'after the template is hard-deleted.';

-- ---------------------------------------------------------------------------
-- PHASE 2: AUDIT TABLE — old key -> new field id
-- ---------------------------------------------------------------------------
-- Not org-scoped and not RLS-protected on purpose: it is migration scaffolding,
-- readable only via service_role / direct DB access, and is expected to be
-- dropped once the conversion is verified in production.

CREATE TABLE IF NOT EXISTS public._cg_field_key_map (
    id BIGSERIAL PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    old_key TEXT NOT NULL,
    new_field_id TEXT,
    resolved_from TEXT NOT NULL,   -- 'universal' | 'employee_column' | 'fallback' | 'archived_key_array'
    resolved_label TEXT,
    resolved_type TEXT,
    role_id TEXT,
    is_required BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx__cg_field_key_map_source
    ON public._cg_field_key_map(source_table, source_id);

-- ---------------------------------------------------------------------------
-- PHASE 3: TRANSFORM FUNCTION
-- ---------------------------------------------------------------------------
-- One function used by templates, versions and both snapshot columns, so the
-- resolution rules cannot drift between the four call sites.
--
-- Resolution precedence mirrors App_ContractFiller.extractFields_Pdf exactly:
--   universal key  ->  employee_columns row  ->  fallback to the raw key/type.

CREATE OR REPLACE FUNCTION public.cg_seed_signer_roles()
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT jsonb_build_array(
        jsonb_build_object('id', 'rol_sender', 'name', 'Sender',  'order', 0, 'color', '#6366f1'),
        jsonb_build_object('id', 'rol_signer', 'name', 'Signer',  'order', 1, 'color', '#2d7a4f')
    );
$$;

CREATE OR REPLACE FUNCTION public.cg_upgrade_layout_v2(
    p_layout      JSONB,
    p_mandatory   JSONB,
    p_hr          JSONB,
    p_attachment  JSONB,
    p_source_table TEXT DEFAULT NULL,
    p_source_id    TEXT DEFAULT NULL,
    p_audit        BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_field        JSONB;
    v_elem         JSONB;
    v_out          JSONB := '[]'::jsonb;
    v_key          TEXT;
    v_label        TEXT;
    v_type         TEXT;
    v_src          TEXT;
    v_options      JSONB;
    v_role         TEXT;
    v_required     BOOLEAN;
    v_new_id       TEXT;
    v_col          RECORD;
BEGIN
    -- Only array-kind layouts (the `pdf` template kind) carry positioned fields.
    -- `tiptap` layouts are ProseMirror documents (jsonb objects) and pass through.
    IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'array' THEN
        RETURN p_layout;
    END IF;

    FOR v_field IN SELECT * FROM jsonb_array_elements(p_layout)
    LOOP
        v_key     := v_field ->> 'key';
        v_options := NULL;
        v_label   := NULL;
        v_type    := NULL;
        v_src     := 'fallback';

        -- (a) universal fields — must be checked FIRST, matching the frontend
        IF v_key = 'email' THEN
            v_label := 'Email';       v_type := 'text'; v_src := 'universal';
        ELSIF v_key = 'first_name' THEN
            v_label := 'First Name';  v_type := 'text'; v_src := 'universal';
        ELSIF v_key = 'last_name' THEN
            v_label := 'Last Name';   v_type := 'text'; v_src := 'universal';
        ELSIF v_key = 'birthday' THEN
            v_label := 'Birthday';    v_type := 'date'; v_src := 'universal';
        ELSIF v_key = 'signature' THEN
            v_label := 'Signature';   v_type := 'signature'; v_src := 'universal';
        ELSE
            -- (b) employee_columns lookup
            SELECT ec.label AS col_label, ec.type::text AS col_type INTO v_col
            FROM public.employee_columns ec
            WHERE ec.id = v_key;

            IF FOUND THEN
                v_src   := 'employee_column';
                v_label := v_col.col_label;
                v_type  := CASE v_col.col_type
                               WHEN 'text'          THEN 'text'
                               WHEN 'number'        THEN 'number'
                               WHEN 'date'          THEN 'date'
                               WHEN 'boolean'       THEN 'checkbox'
                               WHEN 'single_select' THEN 'choice'
                               WHEN 'multi_select'  THEN 'choice'
                               WHEN 'file'          THEN 'attachment'
                               ELSE 'text'
                           END;

                IF v_col.col_type IN ('single_select', 'multi_select') THEN
                    SELECT coalesce(
                               jsonb_agg(jsonb_build_object('label', ecc.label, 'value', ecc.value)
                                         ORDER BY ecc.created_at),
                               '[]'::jsonb)
                      INTO v_options
                      FROM public.employee_column_choices ecc
                     WHERE ecc.employee_column_id = v_key;
                END IF;
            ELSE
                -- (c) fallback — key is its own label, keep whatever type the layout had
                v_label := v_key;
                v_type  := coalesce(v_field ->> 'type', 'text');
            END IF;
        END IF;

        -- attachment / signature declarations on the layout entry win over the
        -- derived column type, matching how the burn pipeline branches.
        IF p_attachment ? v_key THEN
            v_type := 'attachment';
        ELSIF (v_field ->> 'type') = 'signature' THEN
            v_type := 'signature';
        END IF;

        -- Two orthogonal axes, replacing the conflated tri-state.
        v_role     := CASE WHEN p_hr ? v_key THEN 'rol_sender' ELSE 'rol_signer' END;
        v_required := p_mandatory ? v_key;

        v_new_id := public.generate_id('tfd');

        v_elem := jsonb_build_object(
            'id',       v_new_id,
            'key',      v_key,
            'label',    v_label,
            'type',     v_type,
            'role_id',  v_role,
            'required', v_required,
            'page',     v_field -> 'page',
            'x_pct',    v_field -> 'x_pct',
            'y_pct',    v_field -> 'y_pct',
            'w_pct',    v_field -> 'w_pct',
            'h_pct',    v_field -> 'h_pct'
        );

        IF v_options IS NOT NULL THEN
            v_elem := v_elem || jsonb_build_object('options', v_options);
        END IF;

        -- array || object appends one element; merging options must happen on
        -- the element itself, never on the accumulator.
        v_out := v_out || v_elem;

        IF p_audit THEN
            INSERT INTO public._cg_field_key_map (
                source_table, source_id, old_key, new_field_id,
                resolved_from, resolved_label, resolved_type, role_id, is_required
            ) VALUES (
                p_source_table, p_source_id, v_key, v_new_id,
                v_src, v_label, v_type, v_role, v_required
            );
        END IF;
    END LOOP;

    RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 4: DATA MIGRATION
-- ---------------------------------------------------------------------------
-- The version-writing trigger is suppressed for the duration: this migration
-- rewrites `contract_template_versions` directly, and letting the trigger fire
-- would append spurious versions computed from the pre-drop hash formula.

ALTER TABLE public.contract_templates DISABLE TRIGGER trigger_write_contract_template_version;
ALTER TABLE public.contract_templates DISABLE TRIGGER trg_notify_realtime_contract_templates;

DO $$
DECLARE
    r RECORD;
    v_count INT := 0;
BEGIN
    -- (1) Archive the key arrays of tiptap templates before the columns vanish.
    FOR r IN
        SELECT id, mandatory_field_keys, hr_field_keys, attachment_field_keys
          FROM public.contract_templates
         WHERE jsonb_typeof(layout) <> 'array'
    LOOP
        INSERT INTO public._cg_field_key_map (source_table, source_id, old_key, resolved_from)
        SELECT 'contract_templates(tiptap)', r.id, k, 'archived_key_array'
          FROM (
            SELECT jsonb_array_elements_text(r.mandatory_field_keys) AS k
            UNION ALL SELECT jsonb_array_elements_text(r.hr_field_keys)
            UNION ALL SELECT jsonb_array_elements_text(r.attachment_field_keys)
          ) s;
    END LOOP;

    -- (2) Templates
    FOR r IN SELECT id FROM public.contract_templates LOOP
        UPDATE public.contract_templates t
           SET layout = public.cg_upgrade_layout_v2(
                            t.layout, t.mandatory_field_keys, t.hr_field_keys,
                            t.attachment_field_keys, 'contract_templates', t.id, true),
               signer_roles = public.cg_seed_signer_roles()
         WHERE t.id = r.id;
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'CG-001: upgraded % contract_templates', v_count;

    -- (3) Versions (immutable history — transformed in place, not re-versioned)
    v_count := 0;
    FOR r IN SELECT id FROM public.contract_template_versions LOOP
        UPDATE public.contract_template_versions v
           SET layout = public.cg_upgrade_layout_v2(
                            v.layout, v.mandatory_field_keys, v.hr_field_keys,
                            v.attachment_field_keys, 'contract_template_versions', v.id, true),
               signer_roles = public.cg_seed_signer_roles()
         WHERE v.id = r.id;
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'CG-001: upgraded % contract_template_versions', v_count;

    -- (4) Invitation snapshots — carry the three key arrays inside the snapshot
    v_count := 0;
    FOR r IN
        SELECT id, template_snapshot AS snap
          FROM public.onboarding_invitations
         WHERE template_snapshot IS NOT NULL
           AND template_snapshot <> '{}'::jsonb
    LOOP
        UPDATE public.onboarding_invitations i
           SET template_snapshot =
                 (r.snap
                   - 'mandatory_field_keys' - 'hr_field_keys' - 'attachment_field_keys')
                 || jsonb_build_object(
                      'layout', public.cg_upgrade_layout_v2(
                                    r.snap -> 'layout',
                                    coalesce(r.snap -> 'mandatory_field_keys',  '[]'::jsonb),
                                    coalesce(r.snap -> 'hr_field_keys',         '[]'::jsonb),
                                    coalesce(r.snap -> 'attachment_field_keys', '[]'::jsonb),
                                    'onboarding_invitations', r.id, true),
                      'signer_roles', public.cg_seed_signer_roles(),
                      'layout_version', 2)
         WHERE i.id = r.id;
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'CG-001: upgraded % invitation snapshots', v_count;

    -- (5) Contract snapshots — bare payload, no key arrays of their own
    v_count := 0;
    FOR r IN
        SELECT id, template_snapshot AS snap
          FROM public.contracts
         WHERE template_snapshot IS NOT NULL
           AND template_snapshot <> '{}'::jsonb
    LOOP
        UPDATE public.contracts c
           SET template_snapshot =
                 r.snap || jsonb_build_object(
                      'layout', public.cg_upgrade_layout_v2(
                                    r.snap -> 'layout',
                                    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                                    'contracts', r.id, true),
                      'signer_roles', public.cg_seed_signer_roles(),
                      'layout_version', 2)
         WHERE c.id = r.id;
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'CG-001: upgraded % contract snapshots', v_count;
END;
$$;

ALTER TABLE public.contract_templates ENABLE TRIGGER trigger_write_contract_template_version;
ALTER TABLE public.contract_templates ENABLE TRIGGER trg_notify_realtime_contract_templates;

-- ---------------------------------------------------------------------------
-- PHASE 5: VERSIONING TRIGGER — hash over signer_roles instead of key arrays
-- ---------------------------------------------------------------------------
-- Must be replaced BEFORE the columns are dropped: the current body references
-- all three of them.

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
    -- Field definitions now live inside `layout`, so the hash no longer needs
    -- the three key arrays — it covers the layout plus the role set.
    v_new_hash := encode(
        digest(
            NEW.type::text || NEW.layout::text
                || coalesce(NEW.pdf_file_path, '')
                || coalesce(NEW.signer_roles::text, ''),
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
        type, layout, pdf_file_path, signer_roles,
        content_hash, created_by
    ) VALUES (
        NEW.id, NEW.organization_id, v_next_version,
        NEW.type, NEW.layout, NEW.pdf_file_path, NEW.signer_roles,
        v_new_hash, auth.uid()
    );

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- PHASE 6: DROP THE SUPERSEDED COLUMNS
-- ---------------------------------------------------------------------------

ALTER TABLE public.contract_templates
    DROP COLUMN mandatory_field_keys,
    DROP COLUMN hr_field_keys,
    DROP COLUMN attachment_field_keys;

ALTER TABLE public.contract_template_versions
    DROP COLUMN mandatory_field_keys,
    DROP COLUMN hr_field_keys,
    DROP COLUMN attachment_field_keys;

COMMENT ON COLUMN public.contract_templates.layout IS
    'ContractGo layout v2. For `pdf` templates: an array of SELF-DESCRIBING positioned fields '
    '{id, key, label, type, role_id, required, options?, page, x_pct, y_pct, w_pct, h_pct}. '
    'Coordinates are 0-1 floats relative to the page box. label/type/options are inlined — there '
    'is no lookup into any other table, which is what lets a snapshot outlive its template. '
    '`role_id` (who fills it) and `required` (is it mandatory) are orthogonal, replacing the old '
    'conflated hr/mandatory/optional tri-state. For the retired `tiptap` kind this remains a '
    'ProseMirror document object. See CG-001.';

-- ---------------------------------------------------------------------------
-- PHASE 7: DROP THE MIGRATION HELPERS
-- ---------------------------------------------------------------------------
-- `_cg_field_key_map` is intentionally retained as the audit record.

DROP FUNCTION IF EXISTS public.cg_upgrade_layout_v2(JSONB, JSONB, JSONB, JSONB, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.cg_seed_signer_roles();
