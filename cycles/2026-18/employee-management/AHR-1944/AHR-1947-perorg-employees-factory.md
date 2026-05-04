# Per-org employees factory

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `provision_org_employees_table(p_organization_id text)` SECURITY DEFINER function exists. Validates `p_organization_id ~ '^org_[A-Za-z0-9]+$'`. Creates `<orgid>__employees` with `employee_id text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE`. Enables RLS. Attaches four policies (SELECT, INSERT, UPDATE, DELETE) with the org id baked in as a literal. Attaches `trigger_audit_org_employees` calling `audit_employees_perorg(<orgid>)` (function from AHR-1946). Idempotent: re-calling for an existing org is a no-op (early-returns on `pg_class` check).
- AFTER INSERT trigger on `organizations` calls the provisioning function with `NEW.id`.
- AFTER DELETE trigger on `organizations` drops the per-org table (`DROP TABLE IF EXISTS`).
- Migration backfills all existing organizations by looping `organizations` and calling the provisioning function, so every existing org has an empty per-org table after the migration applies.
- `supabase db lint --local` clean for AHR-1947's surface.

## Pass criteria

- Create a fresh org via existing flow → `<new_org_id>__employees` exists with `employee_id PK FK`, RLS enabled, four policies attached, audit trigger attached.
- Insert an employee, then `INSERT INTO <perorg>(employee_id) VALUES (<emp.id>)`. UPDATE the row → exactly one audit row in `employee_audit_log` with correct `organization_id` (taken from `TG_ARGV[0]`).
- DELETE the row → one `__deleted` audit row persists.
- Org A admin attempting `SELECT * FROM <orgB>__employees` via SDK → empty / denied.
- Delete the test org → its per-org table is dropped (verify via `pg_class`).
- After migration applies in dev, every row in `organizations` has a corresponding `<id>__employees` table.

## Scope boundaries

- **No data backfill.** AHR-1947 creates EMPTY per-org tables with the `employee_id` PK only. Adding `col_*` columns and copying values is AHR-1949's job; AHR-1948 owns runtime field-add via the new RPC.
- **No `col_*` columns added.** The bare per-org table contains only `employee_id`. New columns arrive later via AHR-1948's parameterised RPC.
- **No frontend integration.** Reads/writes to the per-org table are AHR-1950 and AHR-1951.
- **No invitee-write policies for the onboarding flow.** Today's onboarding writes to global `employees`. When AHR-1951 rewires onboarding to write `col_*` to per-org, it adds the invitee-scoped policy as a follow-up at that boundary.
- **No types-regen handling for per-org tables in this T2.** Running `pnpm sb:dev:types` after AHR-1947 would pollute `database.types.ts` with one entry per existing org. AHR-1950 owns the generic `EmployeeDynamicRow` type approach + types-gen filtering; until then `pnpm sb:dev:types` is intentionally NOT run as part of this T2.

## Decisions

- **Decision:** Table naming is `<organization_id>__employees` (org id already starts with `org_`). Final form: `org_aBc123XYZ__employees`.
  **Rationale:** Avoids the redundant `org_org_…` double prefix. Double-underscore separator matches the project's existing `rel__department__employee` precedent. The org id pattern check (`^org_[A-Za-z0-9]+$`) is the SQL-injection barrier at the table-name layer.
- **Decision:** RLS shape mirrors global `employees`: SELECT = `is_org_member(<orgid_literal>)`, INSERT/UPDATE/DELETE = `is_admin_or_owner(<orgid_literal>)`. Org id baked as `%L` literal at provisioning time, not stored as a column on rows.
  **Rationale:** Constant-time check (no per-row column lookup, no FK chain). Org id is implicit from the table name — storing it on every row would be redundant. Mirrors the existing `employees` policy shape: all org members read; only HR writes.
- **Decision:** Policy names include the table name verbatim: `org_members_can_view_<table>`, `admin_or_owner_can_{insert,update,delete}_<table>`.
  **Rationale:** Postgres policy names are scoped per-table, so collision-prevention isn't strictly required, but mirroring the existing convention (`admin_or_owner_can_insert_employee_columns` etc.) keeps grep-ability consistent.
- **Decision:** Audit trigger named `trigger_audit_org_employees` (same name on every per-org table — names are per-table-scoped in PG, no collision).
  **Rationale:** Predictable, greppable. Debugging any per-org table starts from a known trigger name.
- **Decision:** AFTER DELETE on `organizations` for the drop trigger, not BEFORE.
  **Rationale:** All cascades (employees → per-org rows) complete first; the per-org table is empty by the time we drop it. Same transaction, no concurrent risk.
- **Decision:** Idempotency check via `pg_class` lookup, not `CREATE TABLE IF NOT EXISTS`.
  **Rationale:** `IF NOT EXISTS` would skip table creation but still try to attach policies/trigger which would fail with "policy already exists". Clean early-return on existence is simpler and avoids duplicate-error noise.
- **Decision:** Existing-org backfill runs as a single `DO $$ ... $$` block in the migration, calling the provisioning function for every row in `organizations`.
  **Rationale:** Idempotency makes this safe. After migration, every existing org has an empty per-org table; no orphan state where future RPCs reference a non-existent table.

## Implementation

### Phase A — Provisioning function

The core SECURITY DEFINER function. Validates input, checks for existence, creates the table with PK FK, enables RLS, attaches four policies and the audit trigger.

- [x] Create migration file `frontend/vite/supabase/migrations/20260428102105_ahr1947_org_employees_factory.sql`
- [x] Define `public.provision_org_employees_table(p_organization_id TEXT)` with `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
- [x] Validate `p_organization_id !~ '^org_[A-Za-z0-9]+$'` → `RAISE EXCEPTION`
- [x] Compute `v_table_name := p_organization_id || '__employees'`
- [x] Idempotency: early-return if `EXISTS (SELECT 1 FROM pg_class JOIN pg_namespace … WHERE relname = v_table_name AND nspname = 'public')`
- [x] `EXECUTE format('CREATE TABLE public.%I (employee_id TEXT PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE)', v_table_name)`
- [x] `EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name)`
- [x] Attach four policies via `format('CREATE POLICY %I ON public.%I FOR <op> TO authenticated USING (public.is_org_member(%L)) ...', ...)` — SELECT uses `is_org_member`, others use `is_admin_or_owner`
- [x] Attach audit trigger: `format('CREATE TRIGGER trigger_audit_org_employees AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_employees_perorg(%L)', v_table_name, p_organization_id)`

### Phase B — Org lifecycle triggers

Auto-provision on org INSERT, auto-drop on org DELETE.

- [x] Define `public.tg_provision_org_employees_on_org_insert()` returning TRIGGER, calls `provision_org_employees_table(NEW.id)`, returns NEW
- [x] `CREATE TRIGGER trigger_provision_org_employees AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_provision_org_employees_on_org_insert()`
- [x] Define `public.tg_drop_org_employees_on_org_delete()` returning TRIGGER, validates `OLD.id` pattern, computes table name, `EXECUTE format('DROP TABLE IF EXISTS public.%I', v_table_name)`, returns OLD
- [x] `CREATE TRIGGER trigger_drop_org_employees AFTER DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_drop_org_employees_on_org_delete()`

### Phase C — Backfill existing orgs

One-shot loop in the migration. Idempotent calls, so safe to re-run.

- [x] Append `DO $$ DECLARE v_org RECORD; BEGIN FOR v_org IN SELECT id FROM public.organizations LOOP PERFORM public.provision_org_employees_table(v_org.id); END LOOP; END $$;` to the migration

### Phase D — Apply + smoke verify

- [x] `pnpm sb:dev:push` to apply locally
- [x] `cd frontend/vite && supabase db lint --local` — clean for AHR-1947 surface (one pre-existing error in `public.authorize` referencing `org_admins`, unrelated to AHR-1947)
- [x] Verify with psql: `\dt public.org_*__employees` shows one table per existing org (verified — existing org `org_eNQs8MLXx8TaCqAm` has its `__employees` sibling)
- [x] Verify policies: four policies attached on the per-org table — `org_members_can_view_*`, `admin_or_owner_can_{insert,update,delete}_*`
- [x] Verify audit trigger attached: `trigger_audit_org_employees` present
- [x] Smoke INSERT + DELETE on a per-org table → `__inserted` and `__deleted` audit rows captured in `employee_audit_log` with correct `organization_id` from `TG_ARGV[0]`
- [x] Smoke org create: `INSERT INTO organizations` for `org_94s0CywKlHVOV3HH` auto-provisioned its per-org table with all four policies and the audit trigger immediately
- [ ] Smoke org delete → per-org table dropped — **BLOCKED by pre-existing project bug**: deleting an org fails with FK violation on `realtime_table_events.organization_id` from `notify_organization_of_table_change()` triggered during cascade. AHR-1947's drop trigger logic is correct (`AFTER DELETE`, runs `DROP TABLE IF EXISTS`); the cascade itself aborts before my trigger has a chance to commit. Filing as out-of-scope finding for the realtime-events module to address. Smoke org `org_94s0CywKlHVOV3HH` and its per-org table remain as residue in local dev.
- [ ] Smoke RLS via SDK as org-A user — not run from psql (would need an authenticated session). Indirectly verified by policy presence; full SDK-as-orgA test belongs to AHR-1950's frontend integration smoke.
- [x] Note: `pnpm sb:dev:types` is intentionally NOT run in this T2 — it would pollute `database.types.ts` with one entry per org. AHR-1950 owns the generic typing strategy.

### Findings (out-of-scope, surfaced during smoke)

- **Realtime-events FK aborts org delete.** When `DELETE FROM organizations` cascades through child tables, `notify_organization_of_table_change()` (a project-wide realtime trigger) tries to insert into `public.realtime_table_events` with the just-deleted `organization_id`. The FK `realtime_table_events_organization_id_fkey` rejects the insert because the org row is already gone, aborting the entire DELETE transaction. Deleting an org currently fails project-wide regardless of AHR-1947. Likely fix: change the FK to `ON DELETE CASCADE` (already on most child tables), make the realtime insert tolerant of the deleted-org case, or move the realtime trigger to BEFORE DELETE so it fires while the row still exists. Not AHR-1947's responsibility.

## Context

_Stripped at /pp push time. Lives in the plan file only._

Non-tech: Each organization gets a private dedicated table that will hold their dynamic field data, automatically created when an org is provisioned and dropped when an org is deleted. After this T2 the tables exist (empty); subsequent T2s populate them and wire up the frontend.

Tech: Single migration. SECURITY DEFINER provisioning function + two lifecycle triggers on `public.organizations` + DO-block backfill of existing orgs. Per-org table shape: `(employee_id TEXT PK FK → employees.id ON DELETE CASCADE)`. RLS uses `is_org_member` / `is_admin_or_owner` from `ext-supabase-rls-policies`. Audit trigger from AHR-1946 attached with org id passed via `TG_ARGV[0]`.

Related: [Audit log foundation (AHR-1946)](https://plane.jimbui.dev/aiur/browse/AHR-1946/) — provides the `audit_employees_perorg()` trigger function this T2 attaches. [ext-supabase-rls-policies](.claude/skills/ext-supabase-rls-policies/SKILL.md) — `is_admin_or_owner` / `is_org_member` helpers.

Siblings: 8 total, 0 Plane-Done, 2 effective Done — AHR-1945 (Field config metadata, local pending /pp), AHR-1946 (Audit log foundation, local pending /pp).

Execution Order: Step 2 of 4 — Step 1 prerequisites met ✓ (AHR-1945 + AHR-1946 both Done local).

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
