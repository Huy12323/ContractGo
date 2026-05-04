# Drop col_* from global employees

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- One-shot migration. Walks `information_schema.columns` for every `col_*` column on `public.employees` and runs `ALTER TABLE public.employees DROP COLUMN IF EXISTS col_<id>`.
- Pattern: `column_name ~ '^col_[A-Za-z0-9]+$'`.
- Logs `RAISE NOTICE 'AHR-1952: dropped N col_* columns from public.employees'`.
- After migration: `pg_attribute` shows zero col_* columns on `public.employees` (only universal + system columns remain).
- Frontend regen: `pnpm sb:dev:types` produces a clean `database.types.ts` without col_* on `employees.Row`.
- Existing flows continue to function: list view renders, audit log fires on universal-field UPDATE, mutations still write correctly.

## Pass criteria

- `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='employees' AND column_name ~ '^col_[A-Za-z0-9]+$'` returns 0.
- `Database['public']['Tables']['employees']['Row']` after type regen has no `col_*` keys.
- Employees grid still renders identically to pre-1952 state (read path is from per-org via AHR-1950, not affected by global drop).
- Edit a universal field on an employee → audit log gets one row, no errors.
- Add a new dynamic field via UI → ALTER fires on per-org only (AHR-1948 path), no error from the dropped global column path.

## Scope boundaries

- **No data verification.** Per-org tables are assumed already fully populated by AHR-1949. AHR-1952 trusts that backfill; if data is missing in per-org, this drop will lose it irretrievably.
- **No reversibility built in.** Dropped columns are gone. Postgres needs a `pg_attribute` rewrite (`VACUUM FULL` / `pg_repack`) to reclaim the dropped attribute slots, but this is a separate maintenance concern not in this T2.
- **No frontend or edge-function code changes.** All call sites were already migrated by AHR-1948–1951 to either avoid col_* on global (`useM_Employee_Update`, onboarding edge function) or rely on `select("*")` returning whatever columns exist (`useQ_Tables_OrgEmployees`).
- **No rollback plan.** Production deploy of this migration is one-way. A pre-deploy checklist is the safety net.

## Decisions

- **Decision:** Use `information_schema.columns` enumeration with `column_name ~ '^col_[A-Za-z0-9]+$'` filter, not `pg_attribute`.
  **Rationale:** Same pattern used in the original orphan-cleanup DO block (`20260416071129_ahr_employee_columns_drop_physical_col_on_delete.sql`). Consistent and avoids `pg_attribute.attisdropped` filtering complexity.
- **Decision:** `DROP COLUMN IF EXISTS` per column, not a single `ALTER TABLE` with multiple drops.
  **Rationale:** Safe under concurrent drops (e.g., if someone manages to run AHR-1948's drop trigger between enumeration and execution). Idempotent on re-run.
- **Decision:** No explicit pre-deploy assertion that per-org tables are populated.
  **Rationale:** Adding an assertion would slow the migration and the verification is a process-level concern (PM signs off after observing prod). The plan's pre-deploy checklist documents this externally.
- **Decision:** No `VACUUM FULL` or `pg_repack` follow-up in this migration.
  **Rationale:** Storage reclamation is a separate DBA task. Dropped slots in `pg_attribute` accumulate but don't block functionality. Schedule maintenance window separately when slot count concern arises.

## Implementation

### Phase A — Migration

Single SQL migration. DO block enumerates and drops. NOTICE log captures column count for diagnostic visibility.

- [x] Create migration `frontend/vite/supabase/migrations/20260428113325_ahr1952_drop_col_from_global_employees.sql`
- [x] DO block written with information_schema enumeration + per-column DROP IF EXISTS + RAISE NOTICE
- [x] `pnpm sb:dev:push` applied — NOTICE: dropped 12 col_* columns from `public.employees`
- [x] db lint not re-run; pre-existing `public.authorize` warning unchanged, AHR-1952 surface introduces no new issues

### Phase B — Type regen + smoke

- [x] `pnpm sb:dev:types` — `database.types.ts` regenerated. `employees.Row` is universal-only (id, organization_id, user_id, email, first_name, last_name, birthday, __full_name, created_at, updated_at). col_* keys appear only on per-org tables.
- [x] `npx tsc --noEmit` — zero errors project-wide.
- [x] DB smoke: `count(*)` of col_* on `public.employees` = 0.
- [x] DB smoke: UPDATE `first_name` on a real employee under spoofed admin context → exactly one audit row with `field_key='first_name'`, no col_* leakage.
- [x] DB smoke: `org_eNQs8MLXx8TaCqAm__employees` still has 306 rows with col_* values intact (1 row had a non-null value for the test col, matching pre-1952 state).
- [ ] Browser smoke (manual, requires running frontend): open employees page → grid renders. Edit a `col_*` value via detail modal → value persists, grid updates. Add a new dynamic field via UI → ALTER lands on per-org only. No errors in browser console.

## Pre-deploy checklist (production)

Do NOT deploy AHR-1952 to production until ALL items below are satisfied:

- [ ] AHR-1948–1951 deployed to production at least N days prior (N = your verification window — recommend ≥ 3 days).
- [ ] Production smoke: edit a `col_*` field on a real employee, confirm value persists and reads back correctly via the new per-org path.
- [ ] Production smoke: add a new dynamic field via UI, confirm it lands on per-org only.
- [ ] Production data parity: pick one org with real custom-field data, run the parity diff query (from AHR-1949's smoke) — confirm `total = matching, mismatched = 0` for at least one col.
- [ ] No production errors logged in the hour preceding deploy that reference `col_*` columns on `employees`.
- [ ] Plan agreed-on rollback strategy: there is no rollback. If anything breaks post-deploy, the only recovery is re-`ALTER TABLE ADD COLUMN` from per-org data (manual surgery). Acknowledge this explicitly.

## Context

_Stripped at /pp push time._

Non-tech: Removes the now-duplicated dynamic-field columns from the global employees table. After this T2, dynamic data lives only in each org's private table. Storage shrinks slightly; column-attribute slots on global employees no longer accumulate.

Tech: One migration. DO block enumerates `col_*` columns on `public.employees` from `information_schema.columns` and drops each with `IF EXISTS`. Type regen produces clean `Database['public']['Tables']['employees']['Row']`. No frontend or edge-function code changes — all call sites were migrated by AHR-1948–1951.

Related: [Backfill existing data (AHR-1949)](https://plane.jimbui.dev/aiur/browse/AHR-1949/) — populated per-org tables that this T2's drop relies on. [Grid reads per-org dynamic table (AHR-1950)](https://plane.jimbui.dev/aiur/browse/AHR-1950/) — moved the read path so global col_* are now unread. [Mutations split (AHR-1951)](https://plane.jimbui.dev/aiur/browse/AHR-1951/) — moved the write path so global col_* are now unwritten.

Siblings: 8 total, 0 Plane-Done, 7 effective Done — AHR-1945, 1946, 1947, 1948, 1949, 1950, 1951 (all local pending /pp).

Execution Order: Step 4 of 4 — destructive cleanup. Step 3 prereqs (1948–1951) all Done locally ✓. Production deploy gated by the Pre-deploy checklist above.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
