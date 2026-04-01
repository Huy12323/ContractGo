# Session persistence with auto-refresh

Work Item: [AHR-58](https://plane.jimbui.dev/aiur/browse/AHR-58/)
Tier 1: [AHR-14] [v0.1.0 | Auth] Session Management (Todo)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: Session Management (https://outline.jimbui.dev/doc/1da6012b-4f7d-4e26-a37b-49e90cd6cc1d)

## Context (from spec)

Non-tech: Session tokens with automatic refresh. User stays logged in across page reloads. Session invalidated on logout or password change.
Tech: `stores/auth.ts` — TanStack Store with `initAuth()` (calls `getSession()` + `onAuthStateChange`), `signOut()`. `_protected/route.tsx` — `beforeLoad` guard with `getSession()`. Supabase JS v2.49.4 with default config (`persistSession: true`, `autoRefreshToken: true`, localStorage).
Related: App Shell (https://outline.jimbui.dev/doc/...) — org-aware redirect deferred to AHR-26
Siblings: 3 total, 0 Done — [AHR-58 Session persistence (Todo), AHR-59 Logout cleanup (Todo), AHR-60 Multi-tab sync (Todo)]
Execution Order: Step 1 of 3 — no prerequisites (foundation)

## Phase A: Event-aware auth initialization

- [x] Replace manual `getSession()` in `initAuth()` with `INITIAL_SESSION` event handling — remove the separate `getSession()` call, let `onAuthStateChange` with `INITIAL_SESSION` set user/session and clear loading
- [x] Add event-type switch in `onAuthStateChange`: `INITIAL_SESSION` → set state + `loading: false`; `SIGNED_IN` / `TOKEN_REFRESHED` → update user/session; `SIGNED_OUT` → clear user/session to null
- [x] Add `userInitiatedSignOut` module-level flag — `signOut()` sets `true` before calling `supabase.auth.signOut()`

## Phase B: Expired session redirect

- [x] In `SIGNED_OUT` handler: if `userInitiatedSignOut` is false (expired token), redirect to `/login?redirect={currentPath}` via `window.location.href`. Reset flag after handling
- [x] Verify redirect reuses existing `?redirect` search param pattern from AHR-30 — user re-authenticates and returns to where they were

---

## Plane IDs (populated by /pp)

Phase A: AHR-61

- Task 1: AHR-62
- Task 2: AHR-63
- Task 3: AHR-64

Phase B: AHR-65

- Task 1: AHR-66
- Task 2: AHR-67
