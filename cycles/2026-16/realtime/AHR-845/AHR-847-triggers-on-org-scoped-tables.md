# Org-id resolution + triggers on all org-scoped tables

Work Item: AHR-847 (https://plane.jimbui.dev/aiur/browse/AHR-847/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: Every org-scoped database change on any of the 15 watched tables writes a row to the `realtime_table_events` log. This T2 wires the database triggers and the org-id resolution logic that figures out which org each change belongs to — including the two relation tables that need a 1-hop parent lookup.

Tech: New migration `YYYYMMDDHHMMSS_ahr847_realtime_triggers_on_org_scoped_tables.sql`. Two functions — `public.get_organization_id_for_change(p_table_name text, p_record_data jsonb) RETURNS text` (CASE across 15 tables) and `public.notify_organization_of_table_change() RETURNS trigger` (SECURITY DEFINER; uses OLD for DELETE, NEW otherwise; emits `INSERT` into `realtime_table_events`; `RAISE WARNING` + skip if org_id unresolved). 15 `CREATE TRIGGER ... AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW ...` statements. No changes to the `supabase_realtime` publication (only the event table is streamed to the client, per AHR-846).

Related: Database (https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — provides the `generate_id()` helper, the multi-tenant `organization_id` column pattern, and the BEFORE INSERT org-id trigger convention this one mirrors at AFTER level.

Siblings: 7 total, 0 Done — AHR-846 (Done — local, pending /pp), AHR-847 (In Progress — this item), AHR-848 (Planned — local), AHR-849 (Planned — local), AHR-850 (Todo), AHR-851 (Todo), AHR-852 (Todo).

Execution Order: Step 2 of 4. Prerequisite AHR-846 effectively Done ✓ (11/11 tasks checked; /pp deferred per user). Parallel with AHR-848 + AHR-849.

## Phase A: Migration authoring

- [x] Created migration `frontend/vite/supabase/migrations/20260416122226_ahr847_realtime_triggers_on_org_scoped_tables.sql`
- [x] `public.get_organization_id_for_change(p_table_name text, p_record_data jsonb) RETURNS text` — SECURITY DEFINER, search_path=public. CASE arms: `organizations`→`p_record_data->>'id'`; 12 direct-org tables→`p_record_data->>'organization_id'`; `rel__department__employee`→1-hop via `department_id`; `rel__department__invitation`→1-hop via `invitation_id`; ELSE→WARNING + NULL
- [x] `public.notify_organization_of_table_change()` RETURNS trigger — SECURITY DEFINER, uses OLD for DELETE/NEW otherwise; NULL org_id → WARNING + skip (no exception); INSERT event with `TG_OP::realtime_table_events_event_type_enum`
- [x] 15 `CREATE TRIGGER trg_notify_realtime_{table} AFTER INSERT OR UPDATE OR DELETE` statements

## Phase B: Verification

- [x] Applied: `pnpm sb:dev:push` (clean — bundled with AHR-848 migration)
- [x] Regenerated types: `pnpm sb:dev:types`
- [x] DB lint passed (no AHR-847 warnings; pre-existing warnings on `generate_id`, `clean_employee_view_filter_node`, `reorder_employee_views` are unrelated)
- [x] Trigger count via psql: 15 rows found, one per approved table
- [x] Direct-org resolver verified via synthetic `get_organization_id_for_change('departments', '{"organization_id":"org_direct_test"}')` → returns `org_direct_test`. End-to-end INSERT+UPDATE+DELETE on `departments` skipped (no entity seed in local DB); infrastructure identical to organizations-self path which was proven live.
- [x] 1-hop resolver verified via function call: real `department_id` → returns parent's `organization_id` (`dept_scIME1LnKu6G89GS` → `org_2m6qYvrPhXW1AtV0`). Fake id returns NULL as expected.
- [x] `organizations`-self live trigger: UPDATE on a real org produced one event row with `organization_id = id`, `table_name='organizations'`, `event_type='UPDATE'`, fresh (<5s). Verified via end-to-end SQL.
- [x] Unresolvable-org edge case: `get_organization_id_for_change('__nonexistent__', '{}')` → WARNING emitted, NULL returned, no exception

---

## Plane IDs (populated by /pp)

Phase A: AHR-867 (Migration authoring)

- Task 1: AHR-868 — Create migration file
- Task 2: AHR-869 — Write get_organization_id_for_change resolver
- Task 3: AHR-870 — Write notify_organization_of_table_change trigger function
- Task 4: AHR-871 — Attach 15 AFTER triggers (one per org-scoped table)

Phase B: AHR-872 (Verification)

- Task 1: AHR-873 — Apply migration
- Task 2: AHR-874 — Regenerate types
- Task 3: AHR-875 — Run supabase db lint
- Task 4: AHR-876 — Confirm 15 triggers via pg_trigger
- Task 5: AHR-877 — Direct-org resolver synthetic test
- Task 6: AHR-878 — 1-hop resolver test (real + fake parent)
- Task 7: AHR-879 — Live trigger roundtrip on organizations
- Task 8: AHR-880 — Unresolvable-org WARNING path
