-- ============================================
-- AHR-846: Realtime table events (event log)
-- Foundation for the org-scoped realtime sync platform (AHR-845).
-- Every org-scoped table mutation will land one row here (triggers wired in
-- AHR-847). RLS exposes rows to any org member (owner ∪ admin ∪ employee) via
-- the existing is_org_member helper. A single supabase_realtime publication
-- streams INSERTs on this table to a single global channel per user
-- (frontend consumer: AHR-851). Retention cleanup: AHR-848.
-- ============================================

-- PHASE 1: ENUM for event_type (fixed values; TypeScript narrow type)
CREATE TYPE public.realtime_table_events_event_type_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- PHASE 2: TABLE
CREATE TABLE public.realtime_table_events (
    id TEXT PRIMARY KEY DEFAULT generate_id('evt'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    event_type public.realtime_table_events_event_type_enum NOT NULL,
    record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_realtime_table_events_organization_id
    ON public.realtime_table_events(organization_id);

CREATE INDEX idx_realtime_table_events_created_at
    ON public.realtime_table_events(created_at);

-- PHASE 3: RLS — any org member can view their org's events
ALTER TABLE public.realtime_table_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_can_view_realtime_table_events"
    ON public.realtime_table_events FOR SELECT
    TO authenticated
    USING (public.is_org_member(organization_id));

-- No INSERT/UPDATE/DELETE policies — RLS default-denies. Trigger functions
-- (AHR-847) run SECURITY DEFINER and bypass RLS on INSERT. The event log is
-- append-only by design; retention cleanup (AHR-848) runs as a SECURITY
-- DEFINER scheduled function.

-- PHASE 4: Realtime publication membership (self-healing)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_table_events;
