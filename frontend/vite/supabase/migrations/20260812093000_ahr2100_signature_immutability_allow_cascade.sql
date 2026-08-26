-- ============================================
-- AHR-2100: SIGNATURE AUDIT LOG — IMMUTABILITY (CASCADE-PERMITTING)
-- ============================================
--
-- ⚠ RECONSTRUCTED MIGRATION — see 20260812090000 for the full explanation.
--   Recovered from the live database on 2026-08-13.
--
-- Makes `signature_audit_log` genuinely append-only rather than merely
-- policy-restricted. Absent RLS write policies stop `authenticated` clients, but
-- NOT `service_role` — and every workflow write path runs as service_role. A
-- trigger is the only layer that binds all roles, superuser included.
--
-- The trigger fires on UPDATE ONLY, which is the "allow cascade" in this
-- migration's name: DELETE must remain possible so that deleting an organization
-- cascades through `signature_audit_log.organization_id` without erroring. That
-- is a deliberate trade — the log is tamper-evident for the lifetime of its
-- organization, and hash-chained (see signature_verify_chain) so that any
-- surviving copy can still be checked for edits.
-- ============================================

CREATE OR REPLACE FUNCTION public.signature_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'signature_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trigger_signature_audit_log_immutable ON public.signature_audit_log;
CREATE TRIGGER trigger_signature_audit_log_immutable
    BEFORE UPDATE ON public.signature_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.signature_audit_log_immutable();
