# [v0.0.1 | Auth] Email verification flow > Surface real edge function errors in verification UI

Work Item: [AHR-549](https://plane.jimbui.dev/aiur/browse/AHR-549/)
Tier 1: [AHR-548] [v0.0.1 | Auth] Email verification flow (In Progress)
Module: [Auth](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/334a5203-d1c4-4472-9e83-5d9df6edcb2e

## Context (from spec)

Non-tech: When an employee or admin clicks an email verification link that's expired, already used, or otherwise invalid, the failure screen used to show an unhelpful technical string ("Edge Function returned a non-2xx status code"). The fix surfaces the real backend reason ("Token has expired", "Invalid or expired token", etc.) and softens the error screen copy so users understand what went wrong and what to do next.
Tech: `Page_VerifyEmail.tsx` `TokenVerification` component, `auth_verify-token` Edge Function (read-only — not modified). The fix is purely in the client's error parsing path.
Related: Discovered while testing [Employee Onboarding](https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b) — clicking an onboarding invitation's verification link while signed in as a different account, or after the link was already consumed. The fix benefits every verification flow that uses `auth_verify-token`, not just onboarding.
Siblings: 1 total, 0 Done — [AHR-549 Surface real edge function errors (In Progress) ←]
Execution Order: First (and currently only) T2 under AHR-548 — no prerequisites.

## Phase A: Frontend — extract real error from FunctionsHttpError and improve copy

- [x] Add `extractEdgeFunctionErrorMessage` helper at top of `Page_VerifyEmail.tsx` — takes any error, casts to `{ context?: Response }`, calls `context.json()` to read the underlying body, returns `body.error` if it's a non-empty string, falls back to a friendly default if anything fails (no context, body not JSON, no error field, parse threw). Reusable shape for future edge function callers.
- [x] Rewrite `TokenVerification.useEffect` verify flow to call the helper on `res.error` and store the resolved message in `errorMessage` state. Move `supabase.auth.getSession()` BEFORE the verify call so both success and error branches see the correct `hasSession` value.
- [x] Soften error screen copy in `TokenVerification`'s error return: title from `"Verification failed"` to `"Can't verify this link"`; subtitle wraps `errorMessage` in a `Typography.Paragraph` plus a secondary explanatory paragraph covering the common causes (already used, expired, wrong account) and the recovery path (sign in and request a new verification email).
- [x] Add contextual "Back to Home" button to error state — only shown when `hasSession === true`. Signed-in users with a dead link should be able to escape to home instead of being forced through the sign-in flow they don't need.

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
