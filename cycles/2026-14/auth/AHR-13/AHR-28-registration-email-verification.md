# Registration with email verification

Work Item: [AHR-28](https://plane.jimbui.dev/aiur/browse/AHR-28/)
Tier 1: [AHR-13] [v0.1.0 | Auth] Email/Password Registration & Login (Todo)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: Email/Password Registration & Login (https://outline.jimbui.dev/doc/c72ea7c3-239a-43e4-8254-fb7a567bb0c1)

## Context (from spec)

Non-tech: Users register with email/password, verify email, and log in. Supabase Auth handles the flow. First user to create an organization becomes the owner.
Tech: `stores/auth.ts` (signUp/signIn/signOut), `components/auth/SignUpForm.tsx`, `components/auth/LoginForm.tsx`, `routes/_auth/` (login, signup), `routes/_protected/route.tsx`, `supabase/config.toml` (auth settings), `supabase/migrations/20260302000000_create_profiles.sql` (profiles table + handle_new_user trigger)
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — org-aware redirect after login is AHR-26 scope
Siblings: 3 total, 0 Done — [AHR-28 Registration (Todo), AHR-29 Password reset (Todo), AHR-30 Login errors (Todo)]
Execution Order: Step 1 of 2 — no prerequisites ✓

## Design References

- **Demo app** (`C:\Coding\aiur\aiur--demo\frontend\vite\src\demos\demo-aiur-hr\`): Gradient background, 420px card, TeamOutlined logo, "AIUR-HR" branding, labeled form fields, "OR" divider
- **Lightcraft** (`C:\Coding\lightcraft\lightcraft\spark\frontend\my-vite-app\`): `beforeLoad` route guards (preferred over component-level auth checks), `?redirect=` search param on login

## Phase A: Adopt demo design system + registration with full name

- [x] Update Ant Design theme in `main.tsx`: primary `#0958d9`, borderRadius `4`, fontFamily `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif`, Button `fontWeight: 600`, Input `paddingBlock: 8, paddingInline: 12`
- [x] Rewrite `_auth/route.tsx` layout: gradient background `linear-gradient(160deg, #d6e4ff 0%, #f0f5ff 30%, #fff1f0 70%, #e6f7ff 100%)`, centered 420px card with shadow/border/logo — shared by all auth child routes (login, signup, verify-email)
- [x] Rewrite `SignUpForm.tsx` to match demo: Full Name (UserOutlined) + Work Email (MailOutlined) + Password 8+ chars (LockOutlined) + Confirm Password, `requiredMark={false}`, "AIUR-HR" + "Create your workspace" header, "OR" divider + sign-in link, terms text
- [x] Rewrite `LoginForm.tsx` to match demo: Work Email + Password, Remember Me + Forgot password link, "AIUR-HR" + "Sign in to your workspace" header, "OR" divider + create account link, terms text
- [x] Update `signUp` in `stores/auth.ts`: accept `fullName` param, pass as `options.data.full_name` to `supabase.auth.signUp()`. The existing `handle_new_user()` trigger already reads `raw_user_meta_data.full_name` into profiles

## Phase B: Email verification flow

- [x] Set `enable_confirmations = true` in `supabase/config.toml` (restart Supabase after)
- [x] Create `_auth/verify-email.tsx` route — shows "Check your email" message with resend button. Update `SignUpForm` to navigate here on successful signup instead of toast
- [x] Add `beforeLoad` guard on `_protected/route.tsx` (Lightcraft pattern): check `supabase.auth.getSession()` → if no session redirect to `/login`, if session exists but `email_confirmed_at` is null redirect to `/verify-email`
- [x] Add `resendVerification(email)` to `stores/auth.ts` — calls `supabase.auth.resend({ type: 'signup', email })`

---

## Plane IDs (populated by /pp)

Phase A: AHR-31
- Task 1: AHR-32
- Task 2: AHR-33
- Task 3: AHR-34
- Task 4: AHR-35
- Task 5: AHR-36

Phase B: AHR-37
- Task 1: AHR-38
- Task 2: AHR-39
- Task 3: AHR-40
- Task 4: AHR-41
