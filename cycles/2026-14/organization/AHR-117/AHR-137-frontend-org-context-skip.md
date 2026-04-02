# Frontend org context & setup-org skip

Work Item: [AHR-137](https://plane.jimbui.dev/aiur/browse/AHR-137/)
Tier 1: [AHR-117](https://plane.jimbui.dev/aiur/browse/AHR-117/) [v0.0.1 | Organization] Organization setup & membership schema (In Progress)
Module: Organization (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/0b7d604a-cbb2-4ed5-ba3d-29f2dab23c2a

## Context (from spec)

Non-tech: Users who sign up can create an org or skip to the dashboard. The frontend detects role (owner/admin/employee) from the new table-based schema and grants permissions accordingly.
Tech: `api/queries/organizations.ts` (queries `organization_members` — dropped), `hooks/use-organization.ts` (uses `Enums<'app_role'>` — dropped), `components/auth/RoleGuard.tsx` (uses `Enums<'app_role'>`), `routes/_protected/route.tsx` (beforeLoad checks `organization_members`), `routes/_auth/setup-organization.tsx` (no skip button). New schema: `organizations.owner_id`, `org_admins`, `org_employees`, `get_org_role` RPC returns text.
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — sidebar/dashboard must handle no-org state
Siblings: 2 total, 1 Done (local) — AHR-136 Membership schema (Done, local, pending /pp), AHR-137 Frontend org context & skip (Todo)
Execution Order: Step 2 of 2 — AHR-136 done (local) ✓

## Phase A: Rewrite organization queries & hook

- [x] Rewrite `organizationQueries.myMemberships()` → `myOrganizations()` in `api/queries/organizations.ts` — query `organizations` table directly (RLS via `is_org_member` handles filtering)
- [x] Add `organizationQueries.myRole(orgId)` — call `get_org_role` RPC to determine owner/admin/employee
- [x] Rewrite `useOrganization` hook — fetch orgs via new query, get role via RPC, owner `hasPermission` always returns true
- [x] Define `OrgRole = 'owner' | 'admin' | 'employee'` type (replaces `Enums<'app_role'>` which no longer exists)

## Phase B: Update auth flow & guards

- [x] Update `RoleGuard` — use `OrgRole` string type instead of `Enums<'app_role'>`
- [x] Remove org membership check from `_protected/route.tsx` `beforeLoad` (no more forced redirect to setup-org — `organization_members` table is gone)
- [x] Ensure sidebar/dashboard handle `organization: null` gracefully (no crash when user has no org)

## Phase C: Setup-org skip button

- [x] Add "Skip for now" button below the form in `setup-organization.tsx` that navigates to `/dashboard`

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)

Phase C: (pending)

- Task 1: (pending)
