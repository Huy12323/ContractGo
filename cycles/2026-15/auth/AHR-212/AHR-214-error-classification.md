# Error classification

Work Item: [AHR-214](https://plane.jimbui.dev/aiur/browse/AHR-214/)
Tier 1: [AHR-212] [v0.0.1 | Auth] Signup flow overhaul (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/c86312ab-a1c8-4870-98a3-549dd687876b

## Context (from spec)

Non-tech: Route signup errors to the correct UI surface — field-specific errors under the form field, system errors as toast notifications.
Tech: `components/auth/App_SignUpForm.tsx` (catch block in `onFinish`), `App.useApp()` for toast messages
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — ANTD App provider wraps the app
Siblings: 3 active, 1 Done — [AHR-216 Login and routing fixes (Done), AHR-213 Verify-email route + signup navigation (Not started), AHR-215 Verify-email guard fallback (Cancelled)]
Execution Order: Step 2 of 2 — AHR-216 done ✓

## Phase A: Classify signup errors

- [x] Add `App` import from `antd` and destructure `const { message: messageApi } = App.useApp()` in `App_SignUpForm`
- [x] Replace catch block: if `err.message` includes "already registered" → `form.setFields` on email field with "This email is already registered". Otherwise → `messageApi.error()` with the error message or fallback "Sign up failed. Please try again."
- [x] Remove the generic `'Sign up failed'` string that currently shows under email for all errors

---

## Plane IDs (populated by /pp)

Phase A: [AHR-250](https://plane.jimbui.dev/aiur/browse/AHR-250/)

- Task 1: [AHR-251](https://plane.jimbui.dev/aiur/browse/AHR-251/) — Add App.useApp() message destructure
- Task 2: [AHR-252](https://plane.jimbui.dev/aiur/browse/AHR-252/) — Replace catch block with error branching
- Task 3: [AHR-253](https://plane.jimbui.dev/aiur/browse/AHR-253/) — Remove generic error string
