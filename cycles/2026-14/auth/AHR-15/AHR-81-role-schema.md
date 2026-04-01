# Role schema and database foundation

Work Item: [AHR-81](https://plane.jimbui.dev/aiur/browse/AHR-81/)
Tier 1: [AHR-15] [v0.1.0 | Auth] RBAC — 4 Roles (Todo)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: RBAC — 4 Roles (https://outline.jimbui.dev/doc/71172368-cb3a-4019-9c8a-246344562fc6)

## Context (from spec)

Non-tech: Four-role access control system enforced at database level. Roles are per-organization. Creator of an org becomes owner. Permissions checked via authorize() function, not hardcoded role checks.
Tech: `supabase/migrations/` (new migration), `supabase/config.toml` (existing), existing `profiles` table stays unchanged. Lightcraft reference: `20251105123520_add_multi_org_custom_ids.sql` for RBAC pattern.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org creation wizard (AHR-17) will replace auto-creation. App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — AHR-82 frontend guards depend on this schema.
Siblings: 2 total, 0 Done — [AHR-81 Role schema (Todo), AHR-82 Frontend guards (Todo)]
Execution Order: Step 1 of 2 — no prerequisites ✓

## Design Decisions

1. UUID primary keys — consistent with existing profiles table
2. `role_permissions` table + `authorize()` function — permission-based checks, not hardcoded role checks. Expensive to refactor later when scattered across RLS policies + frontend
3. Auto-org creation on signup — handle_new_user() creates org + owner membership. Unblocks testing before AHR-17
4. Single migration file — one atomic change, logically sectioned
5. Self-elevation prevention — RLS: updater must be owner/admin AND not editing own row

## Phase A: Migration — enums, tables, seed data

- [x] Create migration file `20260401000000_add_rbac_organizations.sql`
- [x] Create `app_role` enum: owner, admin, manager, employee
- [x] Create `app_permission` enum: manage_organization, manage_members, manage_roles, view_all_employees, manage_employees, view_department_employees, manage_departments, view_own_profile, edit_own_profile
- [x] Create `organizations` table: id (uuid PK), name (text), created_at, updated_at
- [x] Create `organization_members` table: id (uuid PK), user_id (→ profiles), organization_id (→ organizations), role (app_role, default 'employee'), created_at. UNIQUE(organization_id, user_id)
- [x] Create `role_permissions` table: id (uuid PK), role (app_role), permission (app_permission), created_at. UNIQUE(role, permission)
- [x] Seed role_permissions with initial permission matrix (owner: all 9, admin: 8, manager: 3, employee: 2)

## Phase B: RLS helper functions + authorize()

- [x] Create `is_org_member(org_id uuid)` — returns boolean, SECURITY DEFINER
- [x] Create `get_org_role(org_id uuid)` — returns app_role, SECURITY DEFINER
- [x] Create `is_admin_or_owner(org_id uuid)` — returns boolean, SECURITY DEFINER
- [x] Create `authorize(org_id uuid, requested_permission app_permission)` — checks user's role has permission via role_permissions table, SECURITY DEFINER

## Phase C: RLS policies

- [x] Enable RLS on organizations, organization_members, role_permissions
- [x] organizations: SELECT for members, INSERT for authenticated (creates org), UPDATE for owner only
- [x] organization_members: SELECT for org members, INSERT for admin/owner, UPDATE for admin/owner (not own row), DELETE for owner only
- [x] role_permissions: SELECT for all authenticated (read-only lookup table, no INSERT/UPDATE/DELETE)
- [x] Self-elevation prevention: UPDATE policy checks `auth.uid() != organization_members.user_id`

## Phase D: Update handle_new_user() trigger

- [x] Update handle_new_user() in migration: after creating profile, create organization (name from user's full_name + "'s Organization"), insert organization_members row with role = 'owner'
- [x] Grant necessary permissions for trigger execution (SECURITY DEFINER)

---

## Plane IDs (populated by /pp)

Phase A: AHR-83
- Task 1: AHR-84
- Task 2: AHR-85
- Task 3: AHR-86
- Task 4: AHR-87
- Task 5: AHR-88

Phase B: AHR-89
- Task 1: AHR-92
- Task 2: AHR-93
- Task 3: AHR-94
- Task 4: AHR-95

Phase C: AHR-90
- Task 1: AHR-96
- Task 2: AHR-97
- Task 3: AHR-98

Phase D: AHR-91
- Task 1: AHR-99
