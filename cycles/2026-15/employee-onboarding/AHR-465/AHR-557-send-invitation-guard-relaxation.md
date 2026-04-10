# [v0.0.1 | Employee Onboarding] Employee contract signing flow > Send-invitation guard: allow admin/owner self-onboarding

Work Item: [AHR-557](https://plane.jimbui.dev/aiur/browse/AHR-557/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: After AHR-555/AHR-556 stopped seeding owners as phantom employees, the owner has no employees row. To appear in the directory, the owner has to go through the regular onboarding flow — send themselves a contract invitation, fill it, sign it, get approved. The current AHR-497 send-invitation guard rejects self-invitations because it blocks any existing org member. This T2 relaxes the guard so owners and admins WITHOUT an employees row can be invited (or can invite themselves). The guard still blocks real employees and re-sends.
Tech: `frontend/vite/supabase/functions/employee-onboarding_send-invitation/index.ts` — the existing AHR-497 guard has three rejection branches inside `if (authUserRow) { ... }`: owner check, admin check, employee-by-user_id check. AHR-557 drops the owner and admin checks, keeps the employee-by-user_id check. The defensive employee-by-email check (line 184-201) and the ongoing-invitations check (line 203+) stay unchanged.
Related: [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — AHR-556 (sibling T1, now Done) is the structural prerequisite. After AHR-556, owners no longer have phantom employees rows, so relaxing the guard for "owner without employees row" can't accidentally re-onboard someone who was already in the directory.
Siblings: 7 total, 3 Done — [AHR-494 Schema (Done), AHR-495 HR sends (Done), AHR-496 Employee fills (Done local, pending /pp), AHR-497 HR reviews + approves (In Progress — implementation complete, 2 manual QA tasks remain), AHR-498 PDF generation (Not started — parallel sibling, not a blocker), AHR-539 Bug fixes (Done), AHR-557 Send-invitation guard relaxation (Planning) ←]
Execution Order: Step 5 of 5 — paired with AHR-498 (parallel). Prerequisite AHR-497's send-invitation guard is in the working tree (functionally Done) — proceeding.

## Phase A: Relax the guard

- [x] Edit `frontend/vite/supabase/functions/employee-onboarding_send-invitation/index.ts`: removed the owner check and admin check from inside `if (authUserRow) { ... }`. The block now contains only the employee-by-user_id check. The defensive employee-by-email check (line 155-172) and the ongoing-invitations check (line 174-188) are unchanged. Comment block updated to reference AHR-557 and the new behavior.
- [x] Type-check: `npx tsc --noEmit` clean. Only the same 4 pre-existing errors remain (App_LoginForm, App_SignUpForm, main.tsx, _protected/route.tsx — none related to this T2).
- [x] Restart `npx supabase functions serve` so the patched function is picked up by the local Deno runtime (user-confirmed).

## Phase B: Verification

- [x] **Self-invite as owner (was previously blocked):** verified — owner can now invite themselves.
- [x] **End-to-end self-onboard:** verified — owner self-onboards, employees row created.
- [x] **Re-invite blocked after self-onboard:** verified — 409 "already an employee".
- [x] **Real-employee re-invite blocked:** verified.
- [x] **Pending-invitation blocked:** verified — 409 "already a pending invitation".

---

## Plane IDs (populated by /pp)

Phase A: AHR-568

- Task 1: AHR-569
- Task 2: AHR-570
- Task 3: AHR-571

Phase B: AHR-572

- Task 1: AHR-573
- Task 2: AHR-574
- Task 3: AHR-575
- Task 4: AHR-576
- Task 5: AHR-577
