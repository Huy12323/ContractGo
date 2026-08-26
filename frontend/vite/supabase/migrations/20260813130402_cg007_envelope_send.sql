-- CG-007 — What the composer needs to send an envelope.
--
-- Phase H turns a template into a live signature request. Two facts have
-- nowhere to live yet, and both are visible in the burned document, so neither
-- can be left implicit.
--
--   1. `prefilled_values` — values the SENDER filled before sending.
--
--      Templates declare a sender role (`rol_sender`, seeded by CG-001), and
--      fields carrying `role_id = <sender role>` are filled by the person
--      composing the envelope, not by any signer. There is no signer row for
--      the sender — they are not a party to the signature — so `field_values`
--      on `signature_request_signers` cannot hold them.
--
--      The alternative considered and rejected: seeding the first signer's
--      `field_values` with the sender's entries. It burns correctly (finalize
--      merges every signer's map) but it is a lie about provenance — the audit
--      trail would attribute the sender's data to a signer who never typed it,
--      and after CG-005 the whole point of these tables is that the record is
--      evidence.
--
--      Read as the BASE LAYER of the merge: signer values are applied over it,
--      and since a signer can only ever write their own role's field ids
--      (`signing_submit` filters on exactly that), the layers cannot collide.
--
--   2. `template_version_id` — WHICH version was sent.
--
--      `template_snapshot` already makes the request self-sufficient, so this is
--      not needed to render or burn anything. It is provenance: it answers
--      "which version of the template is this document?" without diffing JSONB,
--      which is what a certificate of completion (v1.3) has to state and what
--      `contracts.contract_template_version_id` recorded in v1. ON DELETE SET
--      NULL, because the pointer is a convenience and the snapshot is the truth.

ALTER TABLE public.signature_requests
    ADD COLUMN IF NOT EXISTS prefilled_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS template_version_id TEXT
        REFERENCES public.contract_template_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signature_requests_template_version_id
    ON public.signature_requests(template_version_id);

COMMENT ON COLUMN public.signature_requests.prefilled_values IS
    'Values the SENDER entered at compose time, keyed by TemplateField.id — the '
    'fields whose role_id is the snapshot''s sender role. Signers have no write '
    'access to these ids, so this is the base layer of the burn merge and can '
    'never be overwritten by a signer. Distinct from '
    'signature_request_signers.field_values, which is per-party evidence.';

COMMENT ON COLUMN public.signature_requests.template_version_id IS
    'The contract_template_versions row pinned at send time. Provenance only — '
    'template_snapshot is what actually renders and burns (AHR-1487/1490/1954), '
    'so this is SET NULL on delete rather than blocking it.';
