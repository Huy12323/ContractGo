# Membership schema redesign

Work Item: [AHR-136](https://plane.jimbui.dev/aiur/browse/AHR-136/)
Tier 1: [AHR-117](https://plane.jimbui.dev/aiur/browse/AHR-117/) [v0.0.1 | Organization] Organization setup & membership schema (Todo)
Module: Organization (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/5c3d6f90-53ab-42b6-9f63-9c309cbbab71/)
Outline Spec: https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9
Version Doc: https://outline.jimbui.dev/doc/0b7d604a-cbb2-4ed5-ba3d-29f2dab23c2a

## Context (from spec)

Non-tech: Organizations have a single owner, separate admin and employee roles tracked in dedicated tables. Manager is department-scoped only (future). Users who create an org automatically become its owner.
Tech: `supabase/migrations/20260401000000_add_rbac_organizations.sql` (current schema), `supabase/migrations/20260401030000_add_create_organization_rpc.sql` (current RPC), `packages/shared/src/types/database.types.ts` (generated types). Tables: organizations, organization_members (to drop), organization_role_permissions. Enums: app_role (to drop), app_permission (keep). Functions: is_org_member, get_org_role, is_admin_or_owner, authorize, create_organization, seed_org_permissions.
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — sidebar/dashboard must handle no-org state after AHR-137
Siblings: 2 total, 0 Done — AHR-136 Membership schema (Todo), AHR-137 Frontend org context & skip (Todo)
Execution Order: Step 1 of 2 — no prerequisites ✓

## Phase A: Schema migration SQL

- [x] Create migration file `supabase/migrations/20260402000000_redesign_org_membership.sql`
- [x] Add `owner_id uuid references profiles(id)` to `organizations` (nullable initially for data migration)
- [x] Create `org_admins` table (id uuid PK, user_id FK profiles, organization_id FK organizations, created_at; unique(organization_id, user_id); indexes on user_id and organization_id)
- [x] Create `org_employees` table (same structure as org_admins)
- [x] Migrate data: set `organizations.owner_id` from `organization_members` where role='owner'; insert into `org_admins` from where role='admin'; insert into `org_employees` from where role='employee'
- [x] Make `owner_id` NOT NULL after data migration
- [x] Delete owner/manager rows from `organization_role_permissions`
- [x] Alter `organization_role_permissions.role` from `app_role` enum to `text` with CHECK ('admin', 'employee')
- [x] Drop `organization_members` table
- [x] Drop `app_role` enum
- [x] Rewrite `is_org_member(org_id)` — returns true if user is owner_id OR in org_admins OR in org_employees
- [x] Rewrite `get_org_role(org_id)` — returns text: 'owner', 'admin', or 'employee'
- [x] Rewrite `is_admin_or_owner(org_id)` — check organizations.owner_id OR org_admins
- [x] Rewrite `authorize(org_id, permission)` — if owner → true; else get role from tables → lookup in permission matrix
- [x] Rewrite `create_organization(org_name)` — insert org with `owner_id = auth.uid()`, seed permissions (no organization_members insert)
- [x] Rewrite `seed_org_permissions(org_id)` — seed only admin and employee permission rows
- [x] Enable RLS on `org_admins` + create policies (select: members, insert/delete: admin/owner)
- [x] Enable RLS on `org_employees` + create policies (select: members, insert/delete: admin/owner)
- [x] Update RLS policies on `organizations` (dropped + recreated policies that depended on get_org_role)
- [x] Add `org_admins` and `org_employees` to supabase_realtime publication

## Phase B: Type regeneration & verification

- [x] Run `pnpm db:types` to regenerate Supabase TypeScript types
- [x] Verify `app_role` enum is removed from generated types
- [x] Verify new tables (`org_admins`, `org_employees`) and `owner_id` column appear in types
- [x] Verify `app_permission` enum is unchanged

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)
- Task 7: (pending)
- Task 8: (pending)
- Task 9: (pending)
- Task 10: (pending)
- Task 11: (pending)
- Task 12: (pending)
- Task 13: (pending)
- Task 14: (pending)
- Task 15: (pending)
- Task 16: (pending)
- Task 17: (pending)
- Task 18: (pending)
- Task 19: (pending)
- Task 20: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
