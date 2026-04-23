# Drop entity/department wizard step + send-invitation backend

Work Item: [AHR-1174](https://plane.jimbui.dev/aiur/browse/AHR-1174/)
Tier 1: [AHR-1165](https://plane.jimbui.dev/aiur/browse/AHR-1165/) [v0.0.1 | Employee Onboarding] Onboarding flow rework — HR-first fill, comment loop, pending_placement, mandatory fields (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Version Doc: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)

## Context (from spec)

Non-tech: Removes the first step of HR's onboarding wizard (pick entity + departments). Those decisions now happen at placement time, after HR reviews the filled contract. Wizard shrinks from 4 steps to 3: Template → Pre-fill → Email + Send.

Tech: `App_OnboardingWizardModal.tsx` (drop Step 1 JSX + state + hooks), `useM_OnboardingInvitation_Send.ts` (drop entity_id + department_ids params), `employee-onboarding_send-invitation` edge fn (drop entity/department handling, preserve auth + duplicate + ongoing-invitation guards + email send).

Related: [AHR-1173](https://plane.jimbui.dev/aiur/browse/AHR-1173/) (schema foundation — `entity_id` already nullable), [AHR-1178](https://plane.jimbui.dev/aiur/browse/AHR-1178/) (place-employee edge fn consumes entity + department decisions at placement time).

Siblings: 7 total, 1 Done (local) — AHR-1173 Done (local, pending /pp), AHR-1175 Todo, AHR-1176 Todo, AHR-1177 Todo, AHR-1178 Todo, AHR-1179 Todo.

Execution Order: Step 2 of 6 — AHR-1173 (step 1) Done ✓. Parallel with AHR-1175.

## Phase A: Backend (hook + edge fn)

- [x] `frontend/vite/src/hooks/useM_OnboardingInvitation_Send.ts` — drop `entity_id` and `department_ids` from `UseM_OnboardingInvitation_Send_Params`.

- [x] `frontend/vite/supabase/functions/employee-onboarding_send-invitation/index.ts`:
  - Drop `entity_id` and `department_ids` from body destructuring + inline type.
  - Drop `entity_id` from the required-field guard.
  - Drop `entity_id` from the invitation `INSERT` payload — omit the column entirely (now nullable).
  - Delete the entire `rel__department__invitation` junction insert block including its cleanup-on-failure branch.
  - Preserve: auth, admin/owner authz, duplicate-employee-by-auth-user, duplicate-employee-by-email, ongoing-invitation check, email send.

## Phase B: Wizard UI

- [x] `frontend/vite/src/components/employees/App_OnboardingWizardModal.tsx`:
  - Remove `'Entity & Departments'` from `STEPS` (3 entries total).
  - Remove state: `selectedEntityId`, `selectedDepartmentIds`.
  - Remove hooks: `useQ_Tables_OrgEntities`, `useQ_Tables_EntityDepartments`.
  - Remove derived memos: `selectedEntity`, `selectedDepartments`.
  - Remove `handleEntityChange`.
  - `canProceed`: shift cases down by one (0=template, 1=prefill, 2=email).
  - `handleReset`: drop entity + department resets.
  - `handleSend`: drop `entity_id` + `department_ids` from mutation payload.
  - Remove Step 1 JSX block (entity Select + department Checkbox.Group).
  - Renumber step index comments on remaining JSX blocks.
  - Summary (last step): drop Entity + Departments rows. Keep Template + Pre-filled count.
  - Remove unused imports: `Select`, `Checkbox`, `Tag`, `BankOutlined`, `TeamOutlined` — verify each is no longer referenced before deleting.

## Phase C: Verify

- [x] `pnpm type-check` — clean on touched files. Pre-existing errors in `App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx` are unrelated router/history typings.
- [x] Manual smoke: open HR Onboarding → New → 3-step wizard → Template → Prefill → Email + Send → invitation lands. Verify in Studio: `entity_id IS NULL`, zero rows in `rel__department__invitation` for the new invitation.
- [x] Verify existing invitation list renders invitations with `entity_id = NULL` (Entity column shows `—` per AHR-1173 consumer audit — all readers already null-safe).

---

## Plane IDs (populated by /pp)

Phase A: AHR-1443
- Hook params cleanup: AHR-1444
- Edge fn entity/department removal: AHR-1445

Phase B: AHR-1446
- Wizard modal drop Step 1 + state + JSX + summary: AHR-1447

Phase C: AHR-1448
- Type-check + manual send smoke: AHR-1449
