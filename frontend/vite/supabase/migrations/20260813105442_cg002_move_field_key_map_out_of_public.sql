-- ============================================
-- CG-002: MOVE _cg_field_key_map OUT OF THE EXPOSED SCHEMA
-- ============================================
--
-- CG-001 created `public._cg_field_key_map` as a migration audit record and did
-- not enable RLS on it — it is written by a SECURITY DEFINER routine and read
-- only by operators, so no policy seemed necessary.
--
-- That was wrong. Supabase's default privileges grant `anon` and `authenticated`
-- full SELECT/INSERT/UPDATE/DELETE/TRUNCATE on new tables in `public`, and
-- `public` is a PostgREST-exposed schema (see `config.toml` → api.schemas).
-- With RLS disabled there is nothing left to stop an unauthenticated caller
-- reading every organization's field labels and types — or truncating the audit
-- record outright.
--
-- "No RLS policies" only denies access on a table that has RLS *enabled*. On a
-- table with RLS disabled it means the opposite: the GRANTs apply unchecked.
--
-- Fix: move the table into a schema PostgREST does not serve. This is stronger
-- than adding RLS — the table stops being reachable over the API surface at all,
-- and it also disappears from the generated TypeScript types, where migration
-- scaffolding never belonged.
-- ============================================

CREATE SCHEMA IF NOT EXISTS migration_archive;

COMMENT ON SCHEMA migration_archive IS
    'Operator-only records produced by data migrations. Deliberately NOT listed in '
    'config.toml api.schemas, so nothing here is reachable through PostgREST. '
    'Reachable only via direct database access or the service role.';

-- Keep anonymous and end-user roles out even if the schema is ever exposed by
-- accident; USAGE is the gate that makes the objects inside addressable at all.
REVOKE ALL ON SCHEMA migration_archive FROM PUBLIC;
REVOKE ALL ON SCHEMA migration_archive FROM anon, authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
         WHERE schemaname = 'public' AND tablename = '_cg_field_key_map'
    ) THEN
        EXECUTE 'ALTER TABLE public._cg_field_key_map SET SCHEMA migration_archive';
        RAISE NOTICE 'CG-002: moved _cg_field_key_map to migration_archive';
    END IF;
END;
$$;

-- Strip the default grants that rode along from `public`.
REVOKE ALL ON ALL TABLES IN SCHEMA migration_archive FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA migration_archive FROM anon, authenticated;

COMMENT ON TABLE migration_archive._cg_field_key_map IS
    'CG-001 audit record: maps each pre-migration layout field key (a col_* employee_column '
    'id, a universal key, or an unresolvable ghost key) to the template field id that '
    'replaced it, with the label/type/role/required that were derived. Retained so the '
    'harvest is auditable and reversible; safe to drop once the conversion is confirmed '
    'in production.';
