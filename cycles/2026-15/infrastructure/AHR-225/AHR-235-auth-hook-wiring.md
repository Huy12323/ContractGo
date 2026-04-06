# Self-managed email verification and recovery

Work Item: [AHR-235](https://plane.jimbui.dev/aiur/browse/AHR-235/)
Tier 1: [AHR-225] [v0.0.1 | Infrastructure] Unified email delivery via Resend REST (In Progress)
Module: Infrastructure (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/6d0efac1-a915-4c1a-b2ed-62c794ef3105/)
Outline Spec: https://outline.jimbui.dev/doc/9fcfc1d6-ab82-4c88-b9ae-ce70a8dfbd15
Version Doc: https://outline.jimbui.dev/doc/f313c50a-3c78-4a0d-a527-5fc5e5683b2e

## Context (from spec)

Non-tech: Self-manage email verification and password recovery instead of relying on GoTrue's broken SMTP. Users get a session immediately after signup. Verification state tracked in profiles table with RLS. Tokens stored in auth_tokens table. Both flows use Resend REST via the email service.
Tech: New migration (`email_verified` on profiles + `auth_tokens` table), new edge functions (`auth_send-verification`, `auth_verify-token`), config.toml (`enable_confirmations = false`, remove SMTP/hook), frontend guard update (`_protected/route.tsx`). Calls `shared--send-email` for delivery.
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — signup, login, forgot-password routes consume these edge functions
Siblings: 3 total, 1 Done — [AHR-234 Email service (Done), AHR-236 Migrate admin invitation (Todo)]
Execution Order: Step 2 of 2 — AHR-234 done ✓

## Phase A: Database migration

- [x] Revert config.toml: `enable_confirmations = false`, remove SMTP section, remove hook section
- [x] Revert `shared--send-email/index.ts`: remove GoTrue payload handling, clean back to direct-call only
- [x] Update email templates: remove OTP code sections (link-only), 24-hour expiry notice
- [x] Create migration: add `email_verified boolean default false` to `profiles` table
- [x] Create migration: `auth_tokens` table (id generate_id PK, user_id references auth.users, type text check verification|recovery, token uuid default gen_random_uuid(), expires_at timestamptz, created_at timestamptz default now()). Index on token. RLS: service_role only (edge functions use service role key)

## Phase B: Auth edge functions

- [x] Create `auth_send-verification/` edge function with `deno.json`: accepts `{ userId }`, generates token in `auth_tokens` (type=verification, expires 24h), reads user email + name from profiles, calls `shared--send-email` with `auth_confirmation` scenario + confirmationUrl pointing to `/verify-email?token={token}`
- [x] Create `auth_verify-token/` edge function with `deno.json`: accepts `{ token, type }`, validates token exists + not expired + correct type, for verification: updates `profiles.email_verified = true` and deletes token, for recovery: returns `{ valid: true, userId }` (frontend uses admin API to update password)

## Phase C: Frontend wiring

- [x] Update `_protected/route.tsx` beforeLoad: after session check, query `profiles.email_verified` — if false, redirect to `/verify-email`
- [x] Update signup flow: after successful `signUp()`, call `auth_send-verification` edge function with the new user's ID
- [x] Update `forgot-password.tsx`: replace `Store_Auth_Actions.resetPasswordForEmail()` with call to `auth_send-verification` edge function (type=recovery scenario)

---

## Plane IDs (populated by /pp)

Phase A: AHR-254 (Database migration)

- Task 1: AHR-257 (Revert config.toml)
- Task 2: AHR-258 (Revert shared--send-email)
- Task 3: AHR-259 (Update email templates)
- Task 4: AHR-260 (Migration: email_verified on profiles)
- Task 5: AHR-261 (Migration: auth_tokens table + RLS + cleanup)

Phase B: AHR-255 (Auth edge functions)

- Task 1: AHR-262 (auth_send-verification edge function)
- Task 2: AHR-263 (auth_verify-token edge function)

Phase C: AHR-256 (Frontend wiring)

- Task 1: AHR-264 (_protected/route.tsx email_verified guard)
- Task 2: AHR-265 (Signup flow + auth route updates)
- Task 3: AHR-266 (verify-email.tsx page)
