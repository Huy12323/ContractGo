# [v0.0.1 | Employee Onboarding] Employee contract signing flow > HR invitation flow bug fixes + prevention

Work Item: [AHR-539](https://plane.jimbui.dev/aiur/browse/AHR-539/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Three defensive cleanups discovered while executing AHR-496 (employee accepts + fills contract). Two are bug fixes in AHR-495's HR invitation flow that blocked the end-to-end test; one is a prevention layer for the class of bug that caused the first.
Tech: `supabase/functions/employee-onboarding_send-invitation/index.ts` (AHR-495 edge function), `src/components/employees/App_OnboardingModal.tsx` (AHR-495 HR wizard), `.claude/skills/ext-supabase-auth/`, `.claude/skills/ext-supabase-rls-policies/` (new prevention skills).
Related: AHR-494 schema redesign dropped `organization_members` and introduced `is_admin_or_owner` helper; the bible-supabase-* skill files still demonstrate the dropped pattern as generic examples, which led to the stale query shipping in AHR-495.
Siblings: 5 total, 2 Done — [AHR-494 Schema (Done), AHR-495 HR sends invitation (Done local, pending /pp), AHR-496 Employee accepts + fills (In Progress, implemented), AHR-497 HR reviews + approves (Todo), AHR-498 PDF generation (Todo)]
Execution Order: Not in T1's execution ordering — this T2 is a lateral cleanup T2 that emerged during AHR-496 execution. No prerequisites; no items blocked on it.

## Phase A: Backend — fix stale `organization_members` query in send-invitation edge function

- [x] Replace the `supabase.from("organization_members").select("role")` check in `supabase/functions/employee-onboarding_send-invitation/index.ts` with the canonical owner-or-admins pattern. First look up `organizations.owner_id` to resolve the owner case, then fall back to an `admins` table lookup for non-owners with `.maybeSingle()` (non-admin callers are legitimate and must not throw). Return 403 only if neither check passes. Matches the pattern established in `supabase/functions/employee-management_create-column/index.ts:81-102`. Root cause: `organization_members` was dropped in `supabase/migrations/20260402000000_redesign_org_membership.sql` as part of the membership model redesign, but the AHR-495 edge function shipped with the pre-redesign query.

## Phase B: Frontend — strip empty pre-fill entries in HR onboarding wizard

- [x] In `src/components/employees/App_OnboardingModal.tsx` `handleSend` callback, filter `prefilledFields` through `Object.entries(...).filter(([, v]) => v !== undefined && v !== null && v !== '')` before passing to `useM_OnboardingInvitation_Send.mutation.mutate`. Root cause: the wizard's `setPrefilledFields` state accumulates every field HR touches, including cleared ones with empty-string values. Those empty entries were persisting into the `onboarding_invitations.prefilled_fields` JSONB column, and then the employee filler page (AHR-496) was locking the corresponding fields as "read-only" because its `readOnlyKeys` was `new Set(Object.keys(prefilled))` — treating every key present as locked regardless of value.

## Phase C: Prevention — project-specific skill extensions for supabase auth + RLS

- [x] Create `.claude/skills/ext-supabase-auth/SKILL.md` with `base: bible-supabase-auth` frontmatter. Document the project's actual membership model (`organizations.owner_id` + `admins` + `employees`), the three SQL helpers (`is_org_member`, `is_admin_or_owner`, `get_organization_role`) with signatures and source migration, the canonical frontend role check via `useQ_Tables_MyRole`, the canonical route guard via `get_my_member_organizations` RPC, and the canonical edge function admin-or-owner check with inline reference to `employee-management_create-column/index.ts:81-102`. Open with an explicit "This project does NOT use `organization_members`" warning pointing at the migration that dropped it.
- [x] Create `.claude/skills/ext-supabase-rls-policies/SKILL.md` with `base: bible-supabase-rls-policies` frontmatter. Document three canonical policy shapes pulled from live migrations: (1) Admin-or-Owner CRUD via `is_admin_or_owner(organization_id)` — reference `onboarding_invitations`, (2) Admin-or-Self SELECT with optional `signed_by = auth.uid()` branch for pre-approval rows — reference `contracts`, (3) Invitee email-match SELECT using `lower(auth.jwt() ->> 'email')` — reference `admin_invitations` and `onboarding_invitations`. Plus the project's policy naming convention (`admin_or_owner_can_*`, `admin_or_self_can_*`, `invitee_can_*`). Same opening warning.
- [x] Follow the `bible-skill-extension` conventions strictly — do NOT duplicate base content (denormalization strategy, `SECURITY DEFINER`, `(SELECT auth.uid())` wrapping, `BEFORE INSERT` triggers), only override the places where the base's `organization_members` example conflicts with this project. Both extensions open with a callout pointing readers to the base skill first.

---

## Plane IDs (populated by /pp)

Phase A: AHR-540

- Task 1: AHR-541

Phase B: AHR-542

- Task 1: AHR-543

Phase C: AHR-544

- Task 1: AHR-545
- Task 2: AHR-546
- Task 3: AHR-547
