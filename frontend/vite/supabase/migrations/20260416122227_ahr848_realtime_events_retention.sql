-- ============================================
-- AHR-848: Auto-retention cleanup for realtime_table_events
-- Keeps the event log bounded. Enables pg_cron; defines a SECURITY DEFINER
-- cleanup function (bypasses the default-deny DELETE on realtime_table_events);
-- schedules the function hourly at :17 past the hour (off-peak).
-- No fallback logic — if pg_cron is unavailable the migration fails loudly
-- (per PM direction).
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.clean_old_realtime_events()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.realtime_table_events
    WHERE created_at < now() - interval '12 hours';
END;
$$;

SELECT cron.schedule(
    'realtime_events_cleanup',
    '17 * * * *',
    $$SELECT public.clean_old_realtime_events();$$
);
