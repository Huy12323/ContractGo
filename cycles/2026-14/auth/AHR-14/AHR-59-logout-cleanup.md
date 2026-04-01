# Logout with full session cleanup

Work Item: [AHR-59](https://plane.jimbui.dev/aiur/browse/AHR-59/)
Tier 1: [AHR-14] [v0.1.0 | Auth] Session Management (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: Session Management (https://outline.jimbui.dev/doc/1da6012b-4f7d-4e26-a37b-49e90cd6cc1d)

## Context (from spec)

Non-tech: Logout clears all session data. After logout, no stale data remains for the next user.
Tech: `stores/auth.ts` — event-driven `initAuth()` with `SIGNED_OUT` handler + `userInitiatedSignOut` flag (from AHR-58). `lib/query-client.ts` — TanStack Query `queryClient` singleton. `_protected/route.tsx` — `beforeLoad` guard handles back button (no session → redirect to login).
Related: App Shell (AHR-26) — org-aware redirect deferred
Siblings: 3 total, 1 Done — [AHR-58 Session persistence (Done), AHR-59 Logout cleanup (Todo), AHR-60 Multi-tab sync (Todo)]
Execution Order: Step 2 of 3 — AHR-58 done ✓

## Phase A: Logout cleanup and navigation

- [x] Import `queryClient` from `@/lib/query-client` in `stores/auth.ts`. In the `SIGNED_OUT` handler, add the `userInitiatedSignOut` branch: call `queryClient.clear()` to wipe all cached queries
- [x] Add `window.location.href = '/login'` after clearing cache — full page navigation provides clean slate. No `?redirect` param (user chose to log out). Back button protection works via existing `_protected/route.tsx` `beforeLoad` guard

---

## Plane IDs (populated by /pp)

Phase A: AHR-68

- Task 1: AHR-69
- Task 2: AHR-70
