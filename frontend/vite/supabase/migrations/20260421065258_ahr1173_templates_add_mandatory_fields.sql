-- ============================================
-- AHR-1173: Add mandatory_field_keys JSONB on contract_templates
-- ============================================
-- Per-template list of field keys the employee must fill before submitting.
-- Set by HR in Field Composer at template creation (AHR-1176). Enforced in
-- filler page submit gate (AHR-1176).
--
-- Shape enforced in TypeScript override: string[] (field keys from template
-- layout).
-- ============================================

ALTER TABLE public.contract_templates
    ADD COLUMN mandatory_field_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
