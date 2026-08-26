-- ============================================
-- AHR-2100: SIGNATURE WORKFLOW — REALTIME
-- ============================================
--
-- ⚠ RECONSTRUCTED MIGRATION — see 20260812090000 for the full explanation.
--   Recovered from the live database on 2026-08-13.
--
-- Wires the two mutable workflow tables into the project's realtime event bus
-- (`realtime_table_events` → `useSupabaseRealtimeSync` on the frontend), so a
-- sender watching a request sees signer progress without polling.
--
-- `signature_audit_log` and `signature_captures` are deliberately NOT wired up:
--   * the audit log is chatty and append-only — the UI derives progress from
--     signer status, and re-fetching the whole trail on every event is waste;
--   * captures are write-once and always accompanied by a signer status change,
--     which already emits an event.
-- ============================================

DROP TRIGGER IF EXISTS trg_notify_realtime_signature_requests ON public.signature_requests;
CREATE TRIGGER trg_notify_realtime_signature_requests
    AFTER INSERT OR UPDATE OR DELETE ON public.signature_requests
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

DROP TRIGGER IF EXISTS trg_notify_realtime_signature_request_signers ON public.signature_request_signers;
CREATE TRIGGER trg_notify_realtime_signature_request_signers
    AFTER INSERT OR UPDATE OR DELETE ON public.signature_request_signers
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();
