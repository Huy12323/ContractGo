# Login and routing fixes

Work Item: [AHR-216](https://plane.jimbui.dev/aiur/browse/AHR-216/)
Tier 1: [AHR-212] [v0.0.1 | Auth] Signup flow overhaul (Todo)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/c86312ab-a1c8-4870-98a3-549dd687876b

## Context (from spec)

Non-tech: Fix broken post-login redirect and replace all HTML href links in auth pages with TanStack Router client-side navigation.
Tech: `App_LoginForm.tsx` (login redirect), `verify-email.tsx`, `forgot-password.tsx`, `reset-password.tsx` (href → Link conversions)
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — owns /home route that login redirects to
Siblings: 4 total, 0 Done — [AHR-213 Inline verification state (Not started), AHR-214 Error classification (Not started), AHR-215 Verify-email guard fallback (Not started)]
Execution Order: Step 1 of 3 — no prerequisites ✓

## Phase A: Fix login redirect and href anti-patterns

- [x] In `App_LoginForm.tsx:27`, change `navigate({ to: redirectTo || '/dashboard' })` to `navigate({ to: redirectTo || '/' })`
- [x] In `verify-email.tsx:81`, replace `<Typography.Link href="/login">Sign in</Typography.Link>` with TanStack Router `<Link to="/login">` (import Link from `@tanstack/react-router`)
- [x] In `forgot-password.tsx:121`, replace `<Typography.Link href="/login">Back to sign in</Typography.Link>` with `<Link to="/login">`
- [x] In `forgot-password.tsx:158`, replace `<Typography.Link href="/login">Sign in</Typography.Link>` with `<Link to="/login">`
- [x] In `reset-password.tsx:113`, replace `<Button type="primary" href="/forgot-password">` with `<Button type="primary" onClick={() => navigate({ to: '/forgot-password' })}>`
- [x] In `reset-password.tsx:132`, replace `<Button type="primary" href="/login">` with `<Button type="primary" onClick={() => navigate({ to: '/login' })}>`

---

## Plane IDs (populated by /pp)

Phase A: AHR-217

- Task 1: AHR-218
- Task 2: AHR-219
- Task 3: AHR-220
- Task 4: AHR-221
- Task 5: AHR-222
- Task 6: AHR-223
