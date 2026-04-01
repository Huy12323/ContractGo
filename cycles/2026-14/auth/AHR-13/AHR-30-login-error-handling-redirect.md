# Login error handling and redirect

Work Item: [AHR-30](https://plane.jimbui.dev/aiur/browse/AHR-30/)
Tier 1: [AHR-13] [v0.1.0 | Auth] Email/Password Registration & Login (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: Email/Password Registration & Login (https://outline.jimbui.dev/doc/c72ea7c3-239a-43e4-8254-fb7a567bb0c1)

## Context (from spec)

Non-tech: Users log in with email and password. Wrong credentials show a specific error message. Unverified users get guidance to verify their email. After login, users return to the page they were trying to access.
Tech: `components/auth/LoginForm.tsx` (error catch block), `routes/_auth/login.tsx` (route search params), `routes/_protected/route.tsx` (beforeLoad redirect), `stores/auth.ts` (signInWithPassword), `routes/_auth/verify-email.tsx` (existing resend page)
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — org-aware redirect after login is AHR-26 scope
Siblings: 3 total, 1 Done — [AHR-28 Registration (Done), AHR-29 Password reset (Not started), AHR-30 Login errors (Not started)]
Execution Order: Step 2 of 2 — AHR-28 (step 1) Done ✓

## Phase A: Error message parsing and unverified email handling

- [x] Add Supabase error-to-message mapper in `LoginForm.tsx` catch block — parse `error.message`: `"Invalid login credentials"` → `"Invalid email or password"`, unknown errors → `"Unable to sign in. Please try again."`
- [x] Handle `"Email not confirmed"` separately — detect this error and navigate to `/verify-email?email={email}` instead of showing inline error (verify-email page already has resend button from AHR-28)

## Phase B: Post-login redirect with `?redirect` search param

- [x] Add `?redirect` search param to `_auth/login.tsx` route via `validateSearch`, pass `redirect` prop to LoginForm
- [x] Update `LoginForm.tsx` to accept optional `redirect` prop — navigate to `redirect` after successful login, default to `/dashboard`
- [x] Update `_protected/route.tsx` `beforeLoad` — include `location.href` as `?redirect` search param when redirecting unauthenticated users to `/login`

---

## Plane IDs (populated by /pp)

Phase A: AHR-47
- Task 1: AHR-49
- Task 2: AHR-51

Phase B: AHR-53
- Task 1: AHR-55
- Task 2: AHR-56
- Task 3: AHR-57
