# Frontend realtime provider + hook + cache invalidation

Work Item: AHR-851 (https://plane.jimbui.dev/aiur/browse/AHR-851/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: The consumer side of the realtime pipeline. When a user signs in, one WebSocket channel listens for new rows in `realtime_table_events` (populated by the triggers from AHR-847). Incoming events invalidate matching TanStack Query caches so UI refreshes live without manual reload. When users sign out, the channel tears down.

Tech: Two new files — `frontend/vite/src/hooks/useSupabaseRealtimeSync.ts` (fire-and-forget hook) and `frontend/vite/src/providers/realtime/Provider_SupabaseRealtimeSync.tsx` (7-line side-effect wrapper). One edited file: `frontend/vite/src/main.tsx` (provider mount). Hook uses `useQueryClient` + `useStore_Auth_User` to gate subscription; single `supabase.channel("realtime-sync")` listens for `postgres_changes` INSERT on `realtime_table_events`; invalidation predicate matches `[tableName, "list", ...]` (invalidate always) and `[tableName, "record", id, ...]` (invalidate when `record_id === key[tableIdx+2]` OR `record_id === null`). `findIndex`-style table detection for compound keys. Dev-only logging via `import.meta.env.DEV`.

Related:
- bible-tanstack-query-mutation + ext-tanstack-query-mutation (AHR-850) — QueryKeys shape the predicate relies on.
- bible-supabase-sdk — SDK naming conventions (note: `.channel()` is not covered; single-site use confirmed, no ext needed).
- bible-tanstack-store — Store_Auth selector pattern (`useStore_Auth_User`).
- AHR-847 plan — triggers that populate the event stream.
- AHR-849 plan — QueryKeys factory shape.

Siblings: 7 total, 4 Done (local, pending /pp) — AHR-846, AHR-847, AHR-848, AHR-849 complete. AHR-850 (Planned — local, parallel), AHR-851 (In Progress — this item), AHR-852 (Todo).

Execution Order: Step 3 of 4. Prerequisites AHR-846/847/849 all effectively Done ✓. AHR-848 (retention) unrelated but also done. Parallel with AHR-850 (Step 3). Downstream: AHR-852 is the cross-browser verification.

## Phase A: Author hook + provider

- [x] Created `frontend/vite/src/hooks/useSupabaseRealtimeSync.ts` with all expected imports
- [x] Hook body: `queryClient = useQueryClient()`, `user = useStore_Auth_User()`, `isAuthenticated = !!user`, `channelRef = useRef<RealtimeChannel | null>(null)`
- [x] `useEffect([isAuthenticated, queryClient])` — early-returns when unauthenticated; creates `supabase.channel("realtime-sync")` with `postgres_changes` INSERT listener on `realtime_table_events`; cleanup via `supabase.removeChannel` + ref clear
- [x] `handleTableChange(tableName, recordId)` — `queryClient.invalidateQueries({ predicate })` with `findIndex`-style table detection, list-always + record-by-id branches, `recordId === null → invalidate all records` path
- [x] Dev-only logging via `ENABLE_LOGGING = import.meta.env.DEV` — channel status + per-event invalidate/skip counts
- [x] Created `frontend/vite/src/providers/realtime/Provider_SupabaseRealtimeSync.tsx` — 5-line side-effect wrapper matching aiur-hr's `React.ReactNode` convention (consistent with `Provider_ANTD`)

## Phase B: Wire into app root

- [x] Edited `frontend/vite/src/main.tsx` — added import + wrapped `Provider_ANTD` inside `Provider_SupabaseRealtimeSync` under `QueryClientProvider`

## Phase C: Verification (browser smoke deferred to AHR-852)

- [x] `pnpm --filter @aiur-hr/web type-check` — passes clean, 0 errors
- [ ] Browser cross-user smoke test is AHR-852's scope (deferred by design)

---

## Plane IDs (populated by /pp)

Phase A: AHR-917 (Author hook + provider)

- Task 1: AHR-918 — Create useSupabaseRealtimeSync.ts
- Task 2: AHR-919 — Hook body (queryClient, auth, channelRef)
- Task 3: AHR-920 — useEffect channel subscribe + teardown
- Task 4: AHR-921 — handleTableChange invalidation predicate (findIndex)
- Task 5: AHR-922 — Dev logging via import.meta.env.DEV
- Task 6: AHR-923 — Create Provider_SupabaseRealtimeSync.tsx wrapper

Phase B: AHR-924 (Wire into app root)

- Task 1: AHR-925 — Edit main.tsx to mount provider inside QueryClientProvider

Phase C: AHR-926 (Verification)

- Task 1: AHR-927 — pnpm type-check passes clean
