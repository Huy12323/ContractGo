# Auto-retention cleanup for event table

Work Item: AHR-848 (https://plane.jimbui.dev/aiur/browse/AHR-848/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: The event log would grow forever without pruning. A scheduled job runs hourly and deletes any event row older than 12 hours. Frontend clients don't care about ancient events — 12 h is plenty of head-room to recover a backgrounded tab.

Tech: New migration `YYYYMMDDHHMMSS_ahr848_realtime_events_retention.sql`. Enables `pg_cron`, defines `public.clean_old_realtime_events()` (SECURITY DEFINER — bypasses default-deny DELETE on `realtime_table_events`), schedules it via `cron.schedule('realtime_events_cleanup', '17 * * * *', ...)`.

Related: Database (https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — extension management and SECURITY DEFINER conventions.

Siblings: 7 total, 0 Done — AHR-846 (Done — local, pending /pp), AHR-847 (Planned — local), AHR-848 (In Progress — this item), AHR-849 (Planned — local), AHR-850 (Todo), AHR-851 (Todo), AHR-852 (Todo).

Execution Order: Step 2 of 4. Prerequisite AHR-846 effectively Done ✓. Parallel with AHR-847 + AHR-849.

## Phase A: Migration authoring

- [x] Created migration `frontend/vite/supabase/migrations/20260416122227_ahr848_realtime_events_retention.sql`
- [x] `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions` — succeeded on first push (no fallback needed)
- [x] `public.clean_old_realtime_events() RETURNS void` — SECURITY DEFINER, search_path=public, `DELETE FROM realtime_table_events WHERE created_at < now() - interval '12 hours'`
- [x] `cron.schedule('realtime_events_cleanup', '17 * * * *', ...)` — registered, jobid=1

## Phase B: Verification

- [x] Applied: `pnpm sb:dev:push` (bundled with AHR-847 migration, both clean)
- [x] `pg_cron` extension enabled (v1.6.4)
- [x] Cron job registered: jobid=1, schedule `17 * * * *`, runs `SELECT public.clean_old_realtime_events();`
- [x] Backdated-event test: inserted synthetic row `created_at = now() - interval '13 hours'` → `clean_old_realtime_events()` deleted it (before=1, after=0)
- [x] DB lint: no AHR-848 warnings

---

## Plane IDs (populated by /pp)

Phase A: AHR-881 (Migration authoring)

- Task 1: AHR-882 — Create migration file
- Task 2: AHR-883 — Enable pg_cron extension
- Task 3: AHR-884 — Define clean_old_realtime_events function
- Task 4: AHR-885 — Schedule cron job (17 * * * *)

Phase B: AHR-886 (Verification)

- Task 1: AHR-887 — Apply migration
- Task 2: AHR-888 — Confirm pg_cron extension enabled
- Task 3: AHR-889 — Confirm cron job registered
- Task 4: AHR-890 — Backdated-row deletion test
- Task 5: AHR-891 — Run DB lint
