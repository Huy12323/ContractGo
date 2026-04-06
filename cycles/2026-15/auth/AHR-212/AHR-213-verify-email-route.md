# Verify-email route + signup navigation

Work Item: [AHR-213](https://plane.jimbui.dev/aiur/browse/AHR-213/)
Tier 1: [AHR-212] [v0.0.1 | Auth] Signup flow overhaul (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/c86312ab-a1c8-4870-98a3-549dd687876b

## Context (from spec)

Non-tech: After signing up or attempting to log in with an unverified email, users land on a single verification page with a resend button, cooldown timer, and clear error feedback. No email exposed in URL.
Tech: `routes/_auth/verify-email.tsx` (rewrite), `components/auth/App_SignUpForm.tsx` (navigate with state), `components/auth/App_LoginForm.tsx` (navigate with state), `routes/_protected/route.tsx` (remove dead email_confirmed_at check), `stores/Store_Auth.ts` (existing resendVerification — no changes)
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — owns /home route that post-verification login redirects to
Siblings: 3 active (1 cancelled), 1 Done — [AHR-214 Error classification (Not started), AHR-215 Verify-email guard fallback (Cancelled — absorbed), AHR-216 Login and routing fixes (Done)]
Execution Order: Step 2 of 2 — Step 1 (AHR-216) done ✓

## Phase A: Rewrite verify-email route

- [x] Remove `validateSearch` for `?email=` search param — read email from `useLocation().state?.email` (TanStack Router in-memory state). Type as `(location.state as { email?: string })?.email`
- [x] Build resend button with 60-second cooldown timer — `countdown` state initialized to 60 (email just sent), `useRef` for interval ID, `useEffect` that decrements each second and clears on unmount. Button text: `"Resend (Ns)"` during cooldown, `"Resend verification email"` when expired. Button disabled during cooldown and while resending
- [x] Wire resend handler with `App.useApp()` feedback — import `App` from antd, call `Store_Auth_Actions.resendVerification(email)`, on success: `messageApi.success("Verification email sent!")` + reset countdown to 60, on error: `messageApi.error(err.message || "Failed to resend")`. Replace silent catch + one-shot pattern
- [x] Generic fallback when email is missing from state — show "Check the email you used to sign up" without specific address, hide resend button entirely (no email to resend to). Keep "Already verified? Sign in" link

## Phase B: Wire navigation callers + remove dead guard code

- [x] In `App_SignUpForm.tsx:24`: change `navigate({ to: '/verify-email', search: { email: values.email } })` to `navigate({ to: '/verify-email', state: { email: values.email } })`
- [x] In `App_LoginForm.tsx:32`: change `navigate({ to: '/verify-email', search: { email: values.email } })` to `navigate({ to: '/verify-email', state: { email: values.email } })`
- [x] In `_protected/route.tsx:29-34`: remove the `email_confirmed_at` check and its redirect — unreachable dead code with `enable_confirmations=true` (no session exists for unverified users)

---

## Plane IDs (populated by /pp)

Phase A: AHR-224

- Task 1: AHR-226
- Task 2: AHR-227
- Task 3: AHR-228
- Task 4: AHR-229

Phase B: AHR-230

- Task 1: AHR-231
- Task 2: AHR-232
- Task 3: AHR-233
