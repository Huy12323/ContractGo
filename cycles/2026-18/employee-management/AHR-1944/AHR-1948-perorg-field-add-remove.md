# Per-org field add/remove

> Version: [Outline](https://outline.jimbui.dev/doc/56e6639f-1482-46f3-b52a-72cd850bdf4a) | Tier 1: [AHR-1944](https://plane.jimbui.dev/aiur/browse/AHR-1944/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- `add_employee_column(p_organization_id text, p_col_name text, p_col_type text)` SECURITY DEFINER RPC. Validates `p_organization_id ~ '^org_[A-Za-z0-9]+$'`. Validates `p_col_name ~ '^col_[A-Za-z0-9]+$'`. Validates `p_col_type` ∈ allowed list. Verifies caller via `is_admin_or_owner(p_organization_id)`. Sets `lock_timeout = '3s'`. Executes `ALTER TABLE <orgid>__employees ADD COLUMN <col_name> <col_type>`.
- Drop trigger on `employee_columns` DELETE updated: reads `OLD.organization_id` + `OLD.id`, validates pattern, drops the column from `<orgid>__employees`. Old logic that targeted `public.employees` is replaced.
- Edge function `employee-management_create-column/index.ts` passes `organization_id` to the new RPC (third arg).
- `pnpm sb:dev:lint --local` clean for AHR-1948's surface.

## Pass criteria

- As admin of org A, add a `text` field via the existing UI → `ALTER TABLE` ran on `<orgA>__employees` only; `<orgB>__employees` is unchanged.
- Delete the field → DROP COLUMN ran on `<orgA>__employees` only; `employee_columns` row removed.
- As org A admin, calling the RPC with org B's id directly (via SDK) → 403 / authorization error.
- Concurrent ALTER on org A's table and org B's table do not block each other.

## Scope boundaries

- No backfill of existing data — AHR-1949's job.
- col_* on global `public.employees` left untouched. The new drop trigger doesn't touch global anymore — orphaned col_* there are AHR-1952's cleanup.
- No frontend changes beyond the edge function — UI for field-add stays as-is.

## Decisions

- **Decision:** Migration runs `DROP FUNCTION add_employee_column(text, text)` then `CREATE FUNCTION add_employee_column(text, text, text)`.
  **Rationale:** Postgres CREATE OR REPLACE doesn't allow argument-count change. Edge function is the only caller; signature break is safe within the same deploy.
- **Decision:** Drop trigger is updated in the same migration (CREATE OR REPLACE FUNCTION, the existing trigger keeps its binding).
  **Rationale:** Single migration keeps RPC + drop logic consistent. Orphaned col_* on global from before the cutover are cleaned up by AHR-1952.
- **Decision:** Authorization check (`is_admin_or_owner`) lives inside the RPC, not just the edge function.
  **Rationale:** Defense in depth. A future caller (admin script, internal tool) bypassing the edge function still can't escalate.

## Implementation

### Phase A — Migration: replace RPC + drop trigger

Single SQL migration. Drops the old RPC, creates the new 3-arg version, replaces the drop-column trigger function to target per-org.

- [x] Create migration `frontend/vite/supabase/migrations/20260428104401_ahr1948_perorg_field_add_remove.sql`
- [x] `DROP FUNCTION public.add_employee_column(text, text)`
- [x] `CREATE FUNCTION public.add_employee_column(p_organization_id text, p_col_name text, p_col_type text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ ... $$`
- [x] Inside: validate org-id pattern, col-name pattern, col-type whitelist, `is_admin_or_owner(p_organization_id)` check, `SET LOCAL lock_timeout = '3s'`, `EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', p_organization_id || '__employees', p_col_name, p_col_type)`
- [x] Replace the drop-column trigger function (the one fired by `employee_columns` DELETE): read `OLD.organization_id` and `OLD.id`, validate patterns, `EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS %I', OLD.organization_id || '__employees', OLD.id)`
- [x] Run `pnpm sb:dev:push` to apply
- [x] Run `supabase db lint --local` — clean for AHR-1948's surface

### Phase B — Edge function passes organization_id

The only caller of the RPC. Pass `organization_id` already parsed in the request body.

- [x] Update `frontend/vite/supabase/functions/employee-management_create-column/index.ts` to call `supabaseAdmin.rpc("add_employee_column", { p_organization_id: organization_id, p_col_name: column.id, p_col_type: pgType })`
- [x] No other code change in the edge function — `organization_id` is already validated upstream

### Phase C — Smoke verify

- [x] DB-layer smoke (psql with spoofed `auth.uid()`): RPC adds `col_*` to `<orgA>__employees` only; `public.employees` and `<orgB>__employees` unchanged. Drop trigger removes `col_*` from `<orgA>__employees`. Auth gate rejects callers without `is_admin_or_owner` (verified by superuser-without-claims context).
- [ ] Browser smoke (manual, requires running frontend): add field via UI as org A admin → verify `<orgA>__employees` only. Delete via UI → verify drop. Cross-org call (rare in UI; mostly DB-level concern, already verified).
- [ ] Verify lock_timeout: deferred manual smoke (requires concurrent session); `lock_timeout = '3s'` set inside RPC body, tested by inspection.

## Context

_Stripped at /pp push time._

Non-tech: HR can add and remove dynamic fields. Each field create/delete now lands on the org-private table instead of the shared global one — no more cross-org column-budget contention.

Tech: One migration replaces RPC + drop trigger. Edge function passes organization_id. Per-org table name = `<organization_id>__employees`. RLS not affected (RPC is SECURITY DEFINER with explicit `is_admin_or_owner` check).

Related: [Per-org employees factory (AHR-1947)](https://plane.jimbui.dev/aiur/browse/AHR-1947/) — provides the per-org tables this T2 mutates.

Siblings: 8 total, 0 Plane-Done, 3 effective Done — AHR-1945, AHR-1946, AHR-1947 (all local pending /pp).

Execution Order: Step 3 of 4 — bundled with AHR-1949, AHR-1950, AHR-1951 for single cutover deploy. Prerequisites: AHR-1947 done ✓.

Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
