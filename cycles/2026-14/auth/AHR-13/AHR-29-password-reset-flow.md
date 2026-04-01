# Password reset flow

Work Item: [AHR-29](https://plane.jimbui.dev/aiur/browse/AHR-29/)
Tier 1: [AHR-13] [v0.1.0 | Auth] Email/Password Registration & Login (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: Email/Password Registration & Login (https://outline.jimbui.dev/doc/c72ea7c3-239a-43e4-8254-fb7a567bb0c1)

## Context (from spec)

Non-tech: Users who forget their password can request a reset email, click the link, and set a new password. Supabase Auth handles email delivery and token management.
Tech: `stores/auth.ts` (add resetPasswordForEmail + updatePassword), `components/auth/LoginForm.tsx` (fix forgot link), `routes/_auth/forgot-password.tsx` (new), `routes/_auth/reset-password.tsx` (new), `routes/_auth/route.tsx` (exempt reset-password from redirect)
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — redirect target after login is /dashboard for now (AHR-26 scope)
Siblings: 3 total, 1 Done — [AHR-28 Registration (Done), AHR-29 Password reset (Todo), AHR-30 Login errors (Todo)]
Execution Order: Step 2 of 2 — AHR-28 done ✓ (parallel with AHR-30)

## Phase A: Forgot password page + auth store methods

- [x] Add `resetPasswordForEmail(email)` to `stores/auth.ts` — calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`
- [x] Add `updatePassword(password)` to `stores/auth.ts` — calls `supabase.auth.updateUser({ password })`
- [x] Update "Forgot password?" link in `LoginForm.tsx` — change navigate target from `/login` to `/forgot-password`
- [x] Create `_auth/forgot-password.tsx` route — email input form matching auth card design, calls resetPasswordForEmail on submit, shows "Check your email" success state with back-to-login link

## Phase B: Reset password page + auth layout fix

- [x] Update `_auth/route.tsx` — exempt `/reset-password` from the authenticated-user-to-dashboard redirect (users arrive with a session from the Supabase reset email link tokens)
- [x] Create `_auth/reset-password.tsx` route — new password + confirm password form (8+ char minimum matching signup), calls updatePassword on submit, shows success message with link to login
- [x] Handle missing recovery session: if user navigates to `/reset-password` without a valid recovery session, show message and link to `/forgot-password`

---

## Plane IDs (populated by /pp)

Phase A: AHR-42
- Task 1: AHR-43
- Task 2: AHR-44
- Task 3: AHR-45
- Task 4: AHR-46

Phase B: AHR-48
- Task 1: AHR-50
- Task 2: AHR-52
- Task 3: AHR-54
