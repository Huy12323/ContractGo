-- ============================================
-- AHR-1945: Add config jsonb column to employee_columns
-- ============================================
-- Type-specific metadata grab-bag for field definitions. Future field types
-- (currency, datetime, number precision, single-select default, formula
-- expression in P2, linked-record target in P2) carry their per-field options
-- here without requiring a schema migration each time a new type ships.
--
-- NOT NULL DEFAULT '{}'::jsonb so existing rows backfill cleanly and consumers
-- never need null guards. Empty object semantically means "no config".
--
-- No consumer reads `config` in this T2 — this only stores and returns it.
-- ============================================

ALTER TABLE public.employee_columns
    ADD COLUMN config jsonb NOT NULL DEFAULT '{}'::jsonb;
