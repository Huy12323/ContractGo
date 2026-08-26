-- CG-006 — Bind signers to template roles, and give them somewhere to put data.
--
-- AHR-2100 was a signature-IMAGE workflow: a signer's only contribution was a
-- drawn or uploaded PNG, so `signature_request_signers.fields` held that
-- signer's positioned signature boxes and there was nowhere to record a typed
-- value. ContractGo's templates carry text, date, choice, checkbox and
-- attachment fields as well, so two facts are missing.
--
--   `role_id`      — WHICH party this signer is. The template declares abstract
--                    roles (`signer_roles`) and every field names one
--                    (`TemplateField.role_id`); a request maps a real person
--                    onto a role. Without it, "which fields are mine" is not
--                    answerable from the snapshot, and the v1 workaround —
--                    copying the subset into `fields` at send time — is a second
--                    source of truth that drifts the moment routing changes.
--
--   `field_values` — WHAT they entered. Keyed by `TemplateField.id`, not by
--                    `key`: ids are stable across renames and are what the burn
--                    pipeline and the filler already index on.
--
-- `fields` is retained but no longer authoritative — see its comment.

ALTER TABLE public.signature_request_signers
    ADD COLUMN IF NOT EXISTS role_id TEXT,
    ADD COLUMN IF NOT EXISTS field_values JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: CG-005 synthesized one role per distinct `signer_order` when it
-- reconstructed the snapshots of pre-existing requests, using exactly this id
-- form. Matching it here keeps those rows resolvable against their own snapshot.
UPDATE public.signature_request_signers
   SET role_id = 'rol_signer_' || signer_order
 WHERE role_id IS NULL;

ALTER TABLE public.signature_request_signers
    ALTER COLUMN role_id SET NOT NULL;

COMMENT ON COLUMN public.signature_request_signers.role_id IS
    'The `signer_roles[].id` from signature_requests.template_snapshot that this '
    'person fulfils. Fields belonging to this signer are '
    'snapshot.layout filtered on role_id — never a separate copy.';

COMMENT ON COLUMN public.signature_request_signers.field_values IS
    'Values this signer entered, keyed by TemplateField.id. Signature fields are '
    'NOT stored here — the image is an object in storage, referenced by '
    'signature_captures.';

COMMENT ON COLUMN public.signature_request_signers.fields IS
    'DEPRECATED (CG-006). AHR-2100 stored this signer''s positioned fields here, '
    'duplicating what the template snapshot already describes. Derive from '
    'signature_requests.template_snapshot filtered on role_id instead. Retained '
    'only so pre-CG-006 rows stay readable; drops in Phase J.';
