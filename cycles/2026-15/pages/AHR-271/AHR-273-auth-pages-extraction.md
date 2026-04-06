# Auth pages extraction

Work Item: [AHR-273](https://plane.jimbui.dev/aiur/browse/AHR-273/)
Tier 1: [AHR-271] [v0.0.1 | Pages] Route structure refactoring (Todo)
Module: Pages (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/ccb49b56-1a0e-4c59-ba47-914cb3816273/)
Outline Spec: https://outline.jimbui.dev/doc/6c6f11ee-bd9d-4d03-8550-88dcdf0b3628
Version Doc: https://outline.jimbui.dev/doc/e0c1a1ec-94b8-48de-a935-fb6561aa9886

## Context (from spec)

Non-tech: Pages module covers page-level structure for all app screens. Route files should be thin wrappers importing from src/pages/Page_[Name]/.
Tech: 6 auth route files in frontend/vite/src/routes/_auth/ contain full page implementations inline. Layout route (_auth/route.tsx) stays in routes/.
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — auth pages use Store_Auth, supabase auth, App_LoginForm/App_SignUpForm components
Siblings: 2 total, 0 Done — [AHR-273 Auth pages extraction (Todo) ←, AHR-274 Protected pages + URL restructuring (Todo)]
Execution Order: Step 1 of 2 — no prerequisites (foundation)

## Phase A: Create pages folder + extract simple pages

- [x] Create `src/pages/` directory
- [x] Extract Page_Login: create `src/pages/Page_Login/Page_Login.tsx`, move LoginPage function, use `useSearch({ from: '/_auth/login' })` for redirect param. Update route file to thin wrapper with `validateSearch` + import
- [x] Extract Page_SignUp: create `src/pages/Page_SignUp/Page_SignUp.tsx`, move SignUpPage function. Update route file to thin wrapper

## Phase B: Extract complex auth pages

- [x] Extract Page_ForgotPassword: create `src/pages/Page_ForgotPassword/Page_ForgotPassword.tsx`, move ForgotPasswordPage + all internal state/handlers. Update route file to thin wrapper
- [x] Extract Page_ResetPassword: create `src/pages/Page_ResetPassword/Page_ResetPassword.tsx`, move ResetPasswordPage + internal logo/effects. Update route file to thin wrapper
- [x] Extract Page_VerifyEmail: create `src/pages/Page_VerifyEmail/Page_VerifyEmail.tsx`, move VerifyEmailPage + TokenVerification + WaitingForEmail + Logo (all stay in same file). Use `useSearch({ from: '/_auth/verify-email' })` for token param. `validateSearch` and `beforeLoad` stay in route file. Update route file to thin wrapper
- [x] Extract Page_Invitation: create `src/pages/Page_Invitation/Page_Invitation.tsx`, move InvitationPage + InvitationData type + all internal state/handlers. Use `useSearch({ from: '/_auth/invitation' })` for token param. Update route file to thin wrapper

## Phase C: Forward-compatible navigation fixes

- [x] Update auth layout `_auth/route.tsx` beforeLoad: change redirect from `/home` to `/`
- [x] Update Page_Invitation: change all `/home` navigation targets to `/` (lines 88, 116, 148, 244 in current file)

---

## Plane IDs (populated by /pp)

Phase A: AHR-275

- Task 1: AHR-276
- Task 2: AHR-277
- Task 3: AHR-278

Phase B: AHR-279

- Task 1: AHR-280
- Task 2: AHR-281
- Task 3: AHR-282
- Task 4: AHR-283

Phase C: AHR-284

- Task 1: AHR-285
- Task 2: AHR-286
