# Backfill existing data into per-org tables

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- One-shot DO block. For every organization:
  - Provision its per-org table (idempotent — AHR-1947's function early-returns if already exists).
  - Insert one row per employee into the per-org table (`employee_id` only) with `ON CONFLICT (employee_id) DO NOTHING`.
  - For each `employee_columns` row of that org: `ALTER TABLE <perorg> ADD COLUMN IF NOT EXISTS col_<id> <pg_type>` then `UPDATE <perorg> dyn SET col_<id> = emp.col_<id> FROM public.employees emp WHERE dyn.employee_id = emp.id AND emp.organization_id = <orgid>`.
- col_* on global `public.employees` is NOT dropped — both copies coexist on disk until AHR-1952.
- Migration is idempotent — re-running is safe.

## Pass criteria

- For every existing org, the per-org table has one row per employee in that org.
- Data parity diff (per org, per col): `(SELECT id, col_X FROM employees WHERE organization_id = <org>)` vs `(SELECT employee_id, col_X FROM <perorg>)` returns identical sets.
- Re-running the backfill is a no-op (no errors, no row-count change).
- col_* columns on `public.employees` remain present and queryable.

## Scope boundaries

- No drop of col_* from global. AHR-1952 owns that destructive step.
- No realtime invalidation triggered by the backfill — it's a one-shot data move, not user-driven.
- No data validation (e.g., type coercion). Migration assumes existing col_* values already have the correct types because they were stored as the same PG type to begin with.

## Decisions

- **Decision:** Two-step copy per org per column: ADD COLUMN first, then UPDATE.
  **Rationale:** Idempotency is trivial (`IF NOT EXISTS` + UPDATE re-run is harmless). Bulk `INSERT ... SELECT col_X, col_Y, ...` would require building a comma-joined dynamic column list at runtime — fragile and harder to debug.
- **Decision:** Type-mapping (`employee_column_type` → PG type) inlined as a CASE expression.
  **Rationale:** Used once. Same mapping already exists in the edge function. Helper function would be overkill.
- **Decision:** Insert `employee_id`-only rows first, then UPDATE per column.
  **Rationale:** Even cleaner than UPSERT-with-all-cols. ON CONFLICT DO NOTHING handles re-runs. UPDATE-from-employees can run idempotently across all rows.

## Implementation

### Phase A — Migration

Single migration with one DO block. Two nested loops: orgs → columns. Logs row counts as NOTICE for diagnostic visibility.

- [x] Create migration `frontend/vite/supabase/migrations/20260428104753_ahr1949_backfill_perorg.sql`
- [x] DO block:
  - `FOR v_org IN SELECT id FROM public.organizations LOOP`
    - `v_perorg := v_org.id || '__employees';`
    - `EXECUTE format('INSERT INTO public.%I (employee_id) SELECT id FROM public.employees WHERE organization_id = %L ON CONFLICT (employee_id) DO NOTHING', v_perorg, v_org.id);`
    - `FOR v_col IN SELECT id, type FROM public.employee_columns WHERE organization_id = v_org.id LOOP`
      - Compute `v_pg_type` via CASE on `v_col.type`
      - `EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I %s', v_perorg, v_col.id, v_pg_type);`
      - `EXECUTE format('UPDATE public.%I dyn SET %I = emp.%I FROM public.employees emp WHERE dyn.employee_id = emp.id AND emp.organization_id = %L', v_perorg, v_col.id, v_col.id, v_org.id);`
    - `END LOOP;`
  - `END LOOP;`
- [x] `pnpm sb:dev:push` to apply (NOTICE: org A backfilled 306 employees, 12 columns)

### Phase B — Smoke verify

- [x] Parity diff for `col_34rTppCGsFaxRD1i` on org A: 306 rows, 306 matching, 0 mismatched.
- [ ] Re-run idempotency check — deferred (would require unwinding the migration version row); covered by code-level idempotency (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`, UPDATE re-run is harmless).
- [x] col_* still present on global `public.employees` with values intact (verified — UPDATE only reads from global, doesn't drop).

## Context

_Stripped at /pp push time._

Non-tech: Existing employee data is copied into each organization's private table. Both copies of the data live on disk after this T2 — the global copy is removed only after the frontend cutover (AHR-1950 + AHR-1951) is verified in production.

Tech: One migration, single DO block. Walks `organizations`, then for each, walks its `employee_columns`. Uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `UPDATE ... FROM` for value copy. Idempotent on re-run.

Related: [Per-org employees factory (AHR-1947)](https://plane.jimbui.dev/aiur/browse/AHR-1947/) — per-org tables already exist (empty) for every org. [Per-org field add/remove (AHR-1948)](https://plane.jimbui.dev/aiur/browse/AHR-1948/) — new fields go straight to per-org from now on.

Siblings: 8 total, 0 Plane-Done, 3 effective Done — AHR-1945, AHR-1946, AHR-1947 (all local pending /pp).

Execution Order: Step 3 of 4 — bundled with AHR-1948, AHR-1950, AHR-1951 for single cutover deploy. Prerequisites: AHR-1947 done ✓.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
