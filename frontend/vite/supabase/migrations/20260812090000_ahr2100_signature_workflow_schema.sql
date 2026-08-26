-- ============================================
-- AHR-2100: SIGNATURE WORKFLOW — SCHEMA
-- ============================================
--
-- ⚠ RECONSTRUCTED MIGRATION.
--   This migration was recorded as applied in `supabase_migrations.schema_migrations`
--   (version 20260812090000) but its SQL file was never committed to git — it is
--   absent from every branch, tag and stash. The content below was recovered by
--   introspecting the live local database (pg_dump --schema-only) on 2026-08-13
--   and split across the four original version numbers by concern, matching the
--   names recorded in the migration history table.
--
--   It is therefore faithful to the schema that is actually applied, but the
--   original file's exact statement order and comments are unrecoverable.
--   Existing databases already have this applied; this file exists so that fresh
--   environments and production can be provisioned, and so `supabase db push`
--   stops failing on the history/disk mismatch.
--
-- What this establishes:
--   A multi-signer signature workflow over a source PDF. `signature_requests` is
--   the envelope; `signature_request_signers` are its ordered participants;
--   `signature_captures` holds one immutable signature image per signer; and
--   `signature_audit_log` is an append-only, hash-chained evidence trail.
--
--   Routing is expressed by `signature_requests.current_order` advancing through
--   `signature_request_signers.signer_order`. See the RPC migration (091000).
-- ============================================

-- PHASE 1: TABLES

CREATE TABLE IF NOT EXISTS public.signature_requests (
    id TEXT PRIMARY KEY DEFAULT generate_id('sgr'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    entity_id TEXT REFERENCES public.entities(id) ON DELETE SET NULL,
    template_id TEXT REFERENCES public.contract_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    source_pdf_r2_key TEXT NOT NULL,
    source_pdf_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    current_order INTEGER NOT NULL DEFAULT 1,
    signed_pdf_r2_key TEXT,
    signed_pdf_sha256 TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signature_requests_status_check
        CHECK (status = ANY (ARRAY['draft', 'in_progress', 'completed', 'declined', 'cancelled'])),
    CONSTRAINT signature_requests_current_order_check
        CHECK (current_order >= 1),
    -- A completed request must carry its signed artifact and that artifact's
    -- digest; without both there is nothing to verify later.
    CONSTRAINT signature_requests_completed_has_pdf
        CHECK (status <> 'completed' OR (signed_pdf_r2_key IS NOT NULL AND signed_pdf_sha256 IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.signature_request_signers (
    id TEXT PRIMARY KEY DEFAULT generate_id('sgs'),
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    signer_order INTEGER NOT NULL,
    signer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    signer_email TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    notified_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    decline_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signature_request_signers_signer_order_check
        CHECK (signer_order >= 1),
    CONSTRAINT signature_request_signers_status_check
        CHECK (status = ANY (ARRAY['pending', 'notified', 'viewed', 'signed', 'declined'])),
    CONSTRAINT signature_request_signers_request_id_signer_order_key
        UNIQUE (request_id, signer_order),
    CONSTRAINT signature_request_signers_request_id_signer_user_id_key
        UNIQUE (request_id, signer_user_id)
);

-- One capture per signer (UNIQUE signer_id). Rows are immutable — see the guard
-- trigger in the RPC migration. `request_id` and `signer_user_id` are
-- denormalized from the signer row so the capture can be authorized and audited
-- without a join; the guard enforces that they agree.
CREATE TABLE IF NOT EXISTS public.signature_captures (
    id TEXT PRIMARY KEY DEFAULT generate_id('sgc'),
    signer_id TEXT NOT NULL UNIQUE REFERENCES public.signature_request_signers(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
    signer_user_id UUID NOT NULL,
    signature_r2_key TEXT NOT NULL,
    signature_sha256 TEXT NOT NULL,
    capture_method TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_ip INET,
    captured_user_agent TEXT,
    CONSTRAINT signature_captures_capture_method_check
        CHECK (capture_method = ANY (ARRAY['drawn', 'uploaded']))
);

-- Append-only, hash-chained evidence trail. No FK to signature_requests: the log
-- must survive its request for evidentiary purposes, and cascade behaviour is
-- governed by the organization FK only.
CREATE TABLE IF NOT EXISTS public.signature_audit_log (
    id TEXT PRIMARY KEY DEFAULT generate_id('sal'),
    request_id TEXT NOT NULL,
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    signer_id TEXT,
    actor_user_id UUID,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    seq BIGINT NOT NULL,
    prev_hash TEXT,
    entry_hash TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signature_audit_log_event_type_check
        CHECK (event_type = ANY (ARRAY[
            'request_created', 'request_sent', 'signer_notified', 'signer_viewed',
            'signer_signed', 'signer_declined', 'request_completed', 'request_cancelled',
            'document_burned', 'integrity_verified'
        ])),
    CONSTRAINT signature_audit_log_request_id_seq_key UNIQUE (request_id, seq)
);

-- PHASE 2: INDEXES

CREATE INDEX IF NOT EXISTS idx_signature_requests_organization_id
    ON public.signature_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_org_status
    ON public.signature_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_signature_requests_template_id
    ON public.signature_requests(template_id);

CREATE INDEX IF NOT EXISTS idx_signature_request_signers_organization_id
    ON public.signature_request_signers(organization_id);
CREATE INDEX IF NOT EXISTS idx_signature_request_signers_request_order
    ON public.signature_request_signers(request_id, signer_order);
CREATE INDEX IF NOT EXISTS idx_signature_request_signers_signer_user_id
    ON public.signature_request_signers(signer_user_id, status);

CREATE INDEX IF NOT EXISTS idx_signature_captures_request_id
    ON public.signature_captures(request_id);
CREATE INDEX IF NOT EXISTS idx_signature_captures_signer_user_id
    ON public.signature_captures(signer_user_id);

CREATE INDEX IF NOT EXISTS idx_signature_audit_log_organization_id
    ON public.signature_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_request_seq
    ON public.signature_audit_log(request_id, seq);

-- PHASE 3: updated_at TRIGGERS

DROP TRIGGER IF EXISTS on_signature_requests_updated ON public.signature_requests;
CREATE TRIGGER on_signature_requests_updated
    BEFORE UPDATE ON public.signature_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS on_signature_request_signers_updated ON public.signature_request_signers;
CREATE TRIGGER on_signature_request_signers_updated
    BEFORE UPDATE ON public.signature_request_signers
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- PHASE 4: RLS
--
-- Writes are admin/owner only and are additionally gated on state: a request can
-- only be deleted while still `draft`, and signer rows only mutated while still
-- `pending`. Once a request is in flight its participant list is frozen, so the
-- audit trail cannot be invalidated by editing history.
--
-- `signature_captures` and `signature_audit_log` have NO write policies at all —
-- they are written exclusively by SECURITY DEFINER routines.

ALTER TABLE public.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_request_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_signature_requests"
    ON public.signature_requests FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "admin_or_owner_can_insert_signature_requests"
    ON public.signature_requests FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_signature_requests"
    ON public.signature_requests FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_signature_requests"
    ON public.signature_requests FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'draft');

CREATE POLICY "org_members_can_view_signature_request_signers"
    ON public.signature_request_signers FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "admin_or_owner_can_insert_signature_request_signers"
    ON public.signature_request_signers FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_signature_request_signers"
    ON public.signature_request_signers FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'pending');

CREATE POLICY "admin_or_owner_can_delete_signature_request_signers"
    ON public.signature_request_signers FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id) AND status = 'pending');

CREATE POLICY "signer_can_view_own_signature_capture"
    ON public.signature_captures FOR SELECT TO authenticated
    USING (signer_user_id = (SELECT auth.uid()));

CREATE POLICY "org_members_can_view_signature_audit_log"
    ON public.signature_audit_log FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));
