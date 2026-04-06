# Rename org_ membership tables

Work Item: [AHR-323](https://plane.jimbui.dev/aiur/browse/AHR-323/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (In Progress)
Module: Database (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b
Version Doc: https://outline.jimbui.dev/doc/802df46d-8863-44ec-ae4f-d49cf5ff89cb

## Context (from spec)

Non-tech: Database module handling schema, migrations, RLS, and type generation. Three membership tables have redundant `org_` prefix that needs removal.
Tech: 3 tables renamed, 4 RLS helper functions rewritten, all RLS policies on renamed tables recreated, 2 RPCs rewritten, 10 frontend files updated, 1 edge function updated, types regenerated.
Related: Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) - auth flow uses these tables for membership checks; Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) - org creation RPC inserts into admins table
Siblings: 6 total, 3 Done — [AHR-320 Drop currencies (Done), AHR-321 Drop RBAC (Done), AHR-322 Drop identifier (Done), AHR-324 Drop entity_employees (Todo), AHR-325 Add child FK (Todo)]
Execution Order: Step 2 of 3 — all step 1 done ✓

## Phase A: Database migration

Single migration file: `YYYYMMDDHHMMSS_rename_org_membership_tables.sql`

- [x] Rename tables: `ALTER TABLE org_admins RENAME TO admins`, `ALTER TABLE org_employees RENAME TO employees`, `ALTER TABLE org_admin_invitations RENAME TO admin_invitations`
- [x] Drop all RLS policies on the 3 renamed tables (policies reference old table names internally)
- [x] Recreate RLS policies on `admins`: Members can view (is_org_member), Owner can add (owner check), Owner can remove (owner check)
- [x] Recreate RLS policies on `employees`: Members can view (is_org_member), Admin or owner can add (is_admin_or_owner), Admin or owner can remove (is_admin_or_owner)
- [x] Recreate RLS policies on `admin_invitations`: Owner can view/delete (owner check), Invitee can view/update (email check)
- [x] Drop and recreate `is_org_member(text)`: reference `admins` and `employees` instead of `org_admins`/`org_employees`
- [x] Drop and recreate `get_org_role(text)`: reference `admins` and `employees`
- [x] Drop and recreate `is_admin_or_owner(text)`: reference `admins`
- [x] Drop and recreate `has_pending_invitation(text)`: reference `admin_invitations`
- [x] Drop and recreate `accept_admin_invitation` → rename to `accept_invitation`: reference `admin_invitations` and `admins`
- [x] Drop and recreate `get_my_member_organizations`: reference `admins` and `employees`
- [x] Apply migration locally: `supabase db push --local`
- [x] Run `supabase db lint --local` — fix any warnings

## Phase B: Frontend updates

- [x] Rename `useQ_Tables_OrgAdmins.ts` → `useQ_Tables_Admins.ts`: update `.from("org_admins")` → `.from("admins")`, rename export to `useQ_Tables_Admins`, update variable `sb_FromOrgAdmins_Select` → `sb_FromAdmins_Select`, update type export `Tables_OrgAdmins_QueryData` → `Tables_Admins_QueryData`
- [x] Rename `useQ_Tables_OrgInvitations.ts` → `useQ_Tables_AdminInvitations.ts`: update `.from("org_admin_invitations")` → `.from("admin_invitations")`, rename export to `useQ_Tables_AdminInvitations`, update variable `sb_FromOrgAdminInvitations_Select` → `sb_FromAdminInvitations_Select`, update type export
- [x] Update `useQ_Tables_MyInvitations.ts`: update `.from("org_admin_invitations")` → `.from("admin_invitations")`, update variable `sb_FromOrgAdminInvitations_Select` → `sb_FromAdminInvitations_Select`
- [x] Update `useQ_Tables_MyRole.ts`: update `.rpc("get_org_role")` — name stays (function name unchanged)
- [x] Update `useM_OrgSettings_InvitationCancel.ts`: update `.from("org_admin_invitations")` → `.from("admin_invitations")`, update variable name
- [x] Update `useM_PageHome_InvitationReject.ts`: update `.from("org_admin_invitations")` → `.from("admin_invitations")`, update variable name
- [x] Update `useM_PageHome_InvitationAccept.ts`: update `.rpc("accept_admin_invitation")` → `.rpc("accept_invitation")`
- [x] Update `Page_Invitation.tsx`: update `.rpc('accept_admin_invitation')` → `.rpc('accept_invitation')`
- [x] Update `queryKeys.ts`: rename `orgAdminInvitations` → `adminInvitations` and all nested keys
- [x] Update `App_OrgSettingsModal.tsx`: update import from `useQ_Tables_OrgAdmins` → `useQ_Tables_Admins`, update import from `useQ_Tables_OrgInvitations` → `useQ_Tables_AdminInvitations`
- [x] Update `App_EntitySettingsModal.tsx`: update import from `useQ_Tables_OrgAdmins` → `useQ_Tables_Admins`
- [x] Update all other files importing the renamed hooks (grep for old import paths)

## Phase C: Edge function update

- [x] Update `supabase/functions/send-admin-invitation/index.ts`: update `.from("org_admin_invitations")` → `.from("admin_invitations")`

## Phase D: Type regeneration & verification

- [x] Regenerate types: run the project's type generation command
- [x] Verify TypeScript compiles: `pnpm tsc --noEmit` (or project equivalent)
- [ ] Manual smoke test: login → create org → invite admin → accept invitation → verify membership

---

## Plane IDs (populated by /pp)

Phase A: AHR-372
Phase B: AHR-373
Phase C: AHR-374
Phase D: AHR-375
