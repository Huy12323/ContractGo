# Event log table with multi-tenant RLS

Work Item: AHR-846 (https://plane.jimbui.dev/aiur/browse/AHR-846/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (Todo)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: The event log that drives realtime UI sync. Every org-scoped database change writes one row here; RLS makes the row visible only to members of that org, and frontends stream the log via a single global WebSocket channel.

Tech: Migration `frontend/vite/supabase/migrations/20260416115631_ahr846_create_realtime_table_events.sql`. One table `public.realtime_table_events`, one ENUM `realtime_table_events_event_type_enum`, two indexes, one SELECT policy using `public.is_org_member(organization_id)`, and publication membership via `ALTER PUBLICATION supabase_realtime ADD TABLE ...` (wrapped in a self-healing `DO` block that creates the publication if missing). No INSERT/UPDATE/DELETE policies — triggers (AHR-847) run SECURITY DEFINER; app code cannot mutate by design.

Related: Database (https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — provides `generate_id()`, the `is_org_member` helper, and migration/RLS conventions.

Siblings: 7 total, 0 Done — AHR-846 (In Progress — this item), AHR-847 (Todo), AHR-848 (Todo), AHR-849 (Todo), AHR-850 (Todo), AHR-851 (Todo), AHR-852 (Todo).

Execution Order: Step 1 of 4 — no prerequisites. Foundation for AHR-847 (triggers), AHR-848 (retention), AHR-851 (frontend hook).

## Phase A: Migration authoring

- [x] Create migration via `pnpm sb:dev:new ahr846_create_realtime_table_events`
- [x] Define ENUM `realtime_table_events_event_type_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE')`
- [x] Define table `public.realtime_table_events` — `id TEXT PK DEFAULT generate_id('evt')`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `table_name TEXT NOT NULL`, `event_type realtime_table_events_event_type_enum NOT NULL`, `record_id TEXT` (nullable), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` (no `updated_at`)
- [x] Add indexes: `idx_realtime_table_events_organization_id` (RLS predicate) and `idx_realtime_table_events_created_at` (retention sweep in AHR-848)
- [x] Enable RLS; add SELECT policy `org_member_can_view_realtime_table_events` with `USING public.is_org_member(organization_id)`
- [x] Add to publication: self-healing `DO` block creates `supabase_realtime` if absent, then `ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_table_events`

## Phase B: Verification + type regen

- [x] Apply migration: `pnpm sb:dev:push` (preserves existing data — do not use `db reset`)
- [x] Regenerate TypeScript types: `pnpm sb:dev:types` — 7 `realtime_table_events` refs now in `database.types.ts`
- [x] Run DB lint: `cd frontend/vite && supabase db lint --local` — no warnings against AHR-846 objects (pre-existing warnings on `generate_id` and `clean_employee_view_filter_node` are out-of-scope and unrelated)
- [x] RLS metadata check via `pg_policies` (per /p decision: real cross-user leak test deferred to AHR-852): confirmed single SELECT policy `org_member_can_view_realtime_table_events`, roles `{authenticated}`, qual `is_org_member(organization_id)`
- [x] Confirm publication membership: `pg_publication_tables` returns 1 row for `supabase_realtime` / `public.realtime_table_events`

---

## Plane IDs (populated by /pp)

Phase A: AHR-854 (Migration authoring)

- Task 1: AHR-855 — Create migration file
- Task 2: AHR-856 — Define event_type ENUM
- Task 3: AHR-857 — Define realtime_table_events table
- Task 4: AHR-858 — Add indexes on organization_id and created_at
- Task 5: AHR-859 — Enable RLS + SELECT policy via is_org_member
- Task 6: AHR-860 — Add to supabase_realtime publication (self-healing)

Phase B: AHR-861 (Verification + type regen)

- Task 1: AHR-862 — Apply migration via pnpm sb:dev:push
- Task 2: AHR-863 — Regenerate types via pnpm sb:dev:types
- Task 3: AHR-864 — Run supabase db lint --local
- Task 4: AHR-865 — RLS metadata check via pg_policies
- Task 5: AHR-866 — Confirm publication membership
