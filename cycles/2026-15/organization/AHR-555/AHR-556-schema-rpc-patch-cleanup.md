# [v0.0.1 | Organization] Drop employees seed on org creation > Schema: RPC patch + cleanup migration

Work Item: [AHR-556](https://plane.jimbui.dev/aiur/browse/AHR-556/)
Tier 1: [AHR-555] [v0.0.1 | Organization] Drop employees seed on org creation (Todo)
Module: [Organization](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/91312a3a-9fbf-43d7-9f32-eadab41aab8a

## Context (from spec)

Non-tech: Stop seeding new organization owners as half-baked employees. Today, creating an org makes the caller the owner + an admin + a phantom employee row with empty email/name/birthday. After this T2, owners are owner + admin only — they appear in the employee directory only if they go through the regular employee onboarding flow (covered separately under AHR-465 / AHR-557).
Tech: `create_organization` RPC at `supabase/migrations/20260406211234_rename_org_membership_tables.sql:374-401`, `public.employees` table, `public.organizations` table. Single new migration file with a `CREATE OR REPLACE FUNCTION` (drops the `INSERT INTO employees` line) and a narrowly-scoped cleanup `DELETE` (`email = '' AND user_id = owner_id`). RLS helpers (`is_org_member`, `is_admin_or_owner`, `get_organization_role`) already handle the owner-without-employees case via `organizations.owner_id` first, so no helper changes needed.
Related: [Employee Onboarding](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) — AHR-557 (under AHR-465) relaxes the send-invitation duplicate guard so admins/owners without an employees row can self-onboard through the regular contract flow. AHR-557 depends on this T2 landing first so the cleanup eliminates the phantom rows that would otherwise cause guard logic ambiguity.
Siblings: 1 total, 0 Done — [AHR-556 Schema: RPC patch + cleanup migration (Todo) ←]
Execution Order: Step 1 of 1 — sole T2 in this T1, no prerequisites

## Phase A: Migration

- [x] Create `frontend/vite/supabase/migrations/20260410133909_ahr556_drop_employees_seed_on_org_creation.sql` with two statements:
    1. `CREATE OR REPLACE FUNCTION public.create_organization(org_name text)` — same body as `20260406211234_rename_org_membership_tables.sql:374-401` but with the `INSERT INTO public.employees (user_id, organization_id) VALUES (caller_id, new_org_id);` block removed. Function still inserts into `organizations` with `owner_id = caller_id` and into `admins` with `(user_id = caller_id, organization_id = new_org_id)`.
    2. `DELETE FROM public.employees e USING public.organizations o WHERE e.organization_id = o.id AND e.user_id = o.owner_id AND e.email = '';` — narrow cleanup. The join via `organizations` ensures the deleted row is the owner-as-employee phantom for that org, and the `email = ''` filter prevents touching real employee rows even if the same user is an owner of one org and a real employee of another.
- [x] Apply locally: `cd frontend/vite && npx supabase db push --local`
- [x] Run `npx supabase db lint --local` and confirm no NEW warnings introduced (still 1 pre-existing `public.authorize` error, no new ones).

## Phase B: Verification

- [x] Query `SELECT COUNT(*) FROM public.employees WHERE email = '';` against the local DB → 0 rows confirmed. WorldCraft phantom row was the only one and is gone.
- [x] Verify the WorldCraft Logistics org specifically: `SELECT ... FROM public.employees WHERE organization_id = 'org_ENCfWErE0DGItL4W';` → 0 rows confirmed.
- [ ] Manual smoke test (user-driven): sign up a fresh user via the local app, run through Create Organization → verify in Studio that the new org row exists, exactly 1 admins row exists for `(new_user_id, new_org_id)`, and `SELECT COUNT(*) FROM public.employees WHERE organization_id = '<new_org_id>';` returns 0.
- [ ] Sanity-check the WorldCraft owner UX (user-driven): sign in as the owner, navigate to Page_Employees → org chart still renders (it derives from entities/departments, not employees, so this is unchanged), Onboarding modal still opens, no broken queries in the console.
- [x] Regenerate types: `npx supabase gen types typescript --local 2>/dev/null > src/types/database.types.ts`. Types regenerated cleanly (1069 lines), `tsc --noEmit` passes for AHR-556 changes (only the same 4 pre-existing errors unrelated to this T2).

---

## Plane IDs (populated by /pp)

Phase A: AHR-558

- Task 1: AHR-559
- Task 2: AHR-560
- Task 3: AHR-561

Phase B: AHR-562

- Task 1: AHR-563
- Task 2: AHR-564
- Task 3: AHR-565
- Task 4: AHR-566
- Task 5: AHR-567
