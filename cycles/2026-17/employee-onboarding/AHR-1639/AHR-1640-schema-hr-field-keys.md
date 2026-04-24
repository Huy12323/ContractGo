# Schema: add hr_field_keys to templates + snapshots

Work Item: AHR-1640 (https://plane.jimbui.dev/aiur/browse/AHR-1640/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (Todo)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Third field state `hr` joins the existing `mandatory` / `optional` pair. HR fills HR-state fields during contract pre-fill; employees see them read-only with values visible. This T2 adds the schema + plumbing so later T2s can expose the state in the UI.

Tech: New `hr_field_keys` JSONB column on `contract_templates` and `contract_template_versions` (mirrors `mandatory_field_keys`). Versioning trigger extends to include it in the content hash + INSERT list, so toggling HR status produces a new version. Invitation snapshot shape grows from `{layout, mandatory_field_keys}` to `{layout, mandatory_field_keys, hr_field_keys}`; contract snapshot stays bare `layout` (post-sign render only per AHR-1491). Edge function `employee-onboarding_send-invitation` writes the new key when building fresh snapshots. Type overrides + create/update/restore hook body types + query SELECT columns all grow to carry the new field through.

Related: Contract templates versioning ([Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)) — this T2 follows the precedent set by AHR-1490 for `mandatory_field_keys` (schema + versions + trigger + snapshot + hooks landed together).

Siblings: 6 total, 0 Done — AHR-1641 Shared FieldRenderer (Todo, Not started), AHR-1642 Composer wiring (Todo, Not started), AHR-1643 Filler wiring (Todo, Not started), AHR-1644 Wizard + Review wiring (Todo, Not started), AHR-1645 Employee view wiring (Todo, Not started)

Execution Order: Step 1 of 3 — no prerequisites (foundation step)

## Phase A: Schema migration

- [x] Create migration `YYYYMMDDHHMMSS_ahr1640_templates_add_hr_field_keys.sql` with all phases below
- [x] Phase 1: `ALTER TABLE public.contract_templates ADD COLUMN hr_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 2: `ALTER TABLE public.contract_template_versions ADD COLUMN hr_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb`
- [x] Phase 3: Backfill existing v1 version rows — `UPDATE contract_template_versions SET hr_field_keys = COALESCE(t.hr_field_keys, '[]'::jsonb) FROM contract_templates t WHERE v.template_id = t.id AND v.version_number = 1` (parallel to AHR-1490 phase 2 for mandatory_field_keys)
- [x] Phase 4: Recompute v1 content_hash under the new formula — `SET content_hash = encode(digest(type::text || layout::text || coalesce(pdf_file_path, '') || coalesce(mandatory_field_keys::text, '') || coalesce(hr_field_keys::text, ''), 'sha256'), 'hex') WHERE version_number = 1`
- [x] Phase 5: `CREATE OR REPLACE FUNCTION public.write_contract_template_version()` — extend hash formula with `|| coalesce(NEW.hr_field_keys::text, '')`; add `hr_field_keys` to the INSERT column list and `NEW.hr_field_keys` to the VALUES list
- [x] Phase 6: Backfill invitation snapshots — `UPDATE onboarding_invitations SET template_snapshot = template_snapshot || jsonb_build_object('hr_field_keys', '[]'::jsonb)` (unconditional; adds the key where missing, overwrites if already present with `[]` — safe because T2 #1 is the first writer of hr_field_keys into any snapshot)

## Phase B: Edge function — send-invitation

- [x] `frontend/vite/supabase/functions/employee-onboarding_send-invitation/index.ts`: extend the `contract_template_versions` SELECT at ~line 186 from `"id, layout, mandatory_field_keys"` to `"id, layout, mandatory_field_keys, hr_field_keys"`
- [x] Same file, extend the invitation INSERT `template_snapshot` object at ~line 208 to include `hr_field_keys: version.hr_field_keys`
- [x] Update the comment at ~line 182 to mention `hr_field_keys` alongside `mandatory_field_keys`

## Phase C: Types + hooks

- [x] `frontend/vite/src/types/database.override.types.ts`: add `hr_field_keys: string[]` to the `contract_templates` Row override; add `hr_field_keys?: string[]` to Insert and Update overrides
- [x] `frontend/vite/src/hooks/useM_ContractTemplate_Create.ts`: add `hr_field_keys?: string[]` to the Body type; pass it through to the Supabase insert payload when present
- [x] `frontend/vite/src/hooks/useM_ContractTemplate_Update.ts`: add `hr_field_keys: string[]` to the `UseM_ContractTemplate_Update_Body` partial type; pass through in the update payload
- [x] `frontend/vite/src/hooks/useM_ContractTemplate_Restore.ts`: add `hr_field_keys: string[]` to the Body type alongside `mandatory_field_keys`; include it in the update payload so restore writes it to the parent template (triggering a new version row)
- [x] `frontend/vite/src/hooks/useQ_Tables_ContractTemplates.ts`: extend the SELECT string at ~line 9 from `"id, name, layout, mandatory_field_keys, created_at, updated_at"` to include `hr_field_keys`
- [x] `frontend/vite/src/hooks/useQ_Tables_ContractTemplateVersions.ts`: extend version SELECT to include `hr_field_keys` (check both list and detail queries in this file)
- [x] Follow-up: `App_ContractTemplateVersionsModal.tsx` restore callsite passes `hr_field_keys` from the restored version (restore body became required; caller had to be updated)

## Phase D: Apply + regenerate + verify

- [x] Run `supabase db push --local` (from `frontend/vite/`) to apply the migration against the live local DB — must succeed without data loss
- [x] Run `supabase db lint --local` — only pre-existing `v_idx` shadowed-variable warnings from an earlier migration remain; none from AHR-1640
- [x] Regenerate types: `pnpm sb:dev:types` — confirmed `database.types.ts` lists `hr_field_keys` on both tables (6 Json refs: Row/Insert/Update × templates/versions)
- [x] `pnpm type-check` in the frontend workspace — only three pre-existing errors remain (App_LoginForm, App_SignUpForm, main.tsx), all unrelated to AHR-1640
- [x] Spot-check columns via docker exec psql — both tables have `hr_field_keys` jsonb NOT NULL DEFAULT `[]::jsonb`
- [x] Spot-check trigger: toggled `hr_field_keys` on a draft template, confirmed v2 created with the new value and a different content_hash, then reverted (v3 with hash matching v1); test rows cleaned up afterward
- [x] Spot-check invitation backfill: 12/12 `onboarding_invitations.template_snapshot` rows have `hr_field_keys` key present

---

## Plane IDs (populated by /pp)

Phase A: AHR-1646
- Task 1: AHR-1647
- Task 2: AHR-1648
- Task 3: AHR-1649
- Task 4: AHR-1650
- Task 5: AHR-1651
- Task 6: AHR-1652
- Task 7: AHR-1653

Phase B: AHR-1654
- Task 1: AHR-1655
- Task 2: AHR-1656
- Task 3: AHR-1657

Phase C: AHR-1658
- Task 1: AHR-1659
- Task 2: AHR-1660
- Task 3: AHR-1661
- Task 4: AHR-1662
- Task 5: AHR-1663
- Task 6: AHR-1664

Phase D: AHR-1665
- Task 1: AHR-1666
- Task 2: AHR-1667
- Task 3: AHR-1668
- Task 4: AHR-1669
- Task 5: AHR-1670
- Task 6: AHR-1671
- Task 7: AHR-1672
