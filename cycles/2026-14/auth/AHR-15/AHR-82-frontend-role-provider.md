# Frontend role provider and UI guards

Work Item: [AHR-82](https://plane.jimbui.dev/aiur/browse/AHR-82/)
Tier 1: [AHR-15] [v0.1.0 | Auth] RBAC — 4 Roles (In Progress)
Module: Auth (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/a495ff54-6035-437e-95e8-5d06e8ef1d30/)
Outline Spec: https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098
Version Doc: https://outline.jimbui.dev/doc/525e4239-c957-4084-80d7-e58a37d0e4f3
Roadmap Feature: RBAC — 4 Roles (https://outline.jimbui.dev/doc/71172368-cb3a-4019-9c8a-246344562fc6)

## Context (from spec)

Non-tech: Frontend org/role awareness — every component knows which org the user is in and what they can do. Unauthorized routes blocked, UI elements hidden based on permissions.
Tech: `hooks/use-auth.ts` (existing auth hook), `hooks/use-organization.ts` (new), `api/queries/organizations.ts` (new), `routes/_protected/route.tsx` (extend beforeLoad), `components/auth/` (new guard components). DB tables: `organizations`, `organization_members`, `organization_role_permissions`.
Related: App Shell (https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22) — AHR-25 sidebar uses role-filtered nav. Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — AHR-17 replaces setup-org placeholder with full wizard.
Siblings: 2 total, 1 Done — [AHR-81 Role schema (Done), AHR-82 Frontend guards (Todo)]
Execution Order: Step 2 of 2 — AHR-81 Done ✓

## Phase A: Organization query + hook

- [x] Create `api/queries/organizations.ts` — TanStack Query: fetch user's org memberships (organization_members joined with organizations), fetch org's role permissions (organization_role_permissions)
- [x] Create `hooks/use-organization.ts` — `useOrganization()` hook: returns organization, role, permissions array, `hasPermission(permission)` helper, loading state. Auto-selects first org for v0.1.0 (multi-org switcher is future)
- [x] For v0.1.0 single-org: auto-select first org from memberships list

## Phase B: Protected route org guard + layout

- [x] Extend `_protected/route.tsx` beforeLoad: after session + email check, query organization_members — if no memberships redirect to `/setup-organization`
- [x] Create `_auth/setup-organization.tsx` placeholder: name input → insert org + seed_org_permissions() + insert organization_members as owner. Minimal — AHR-17 replaces with full wizard
- [x] Update protected layout header: show org name + role badge (Ant Design Tag) next to user email

## Phase C: Permission-based UI guards

- [x] Create `components/auth/PermissionGuard.tsx` — renders children only if user has permission in current org, otherwise nothing or fallback
- [x] Create `components/auth/RoleGuard.tsx` — renders children only if user's role matches provided roles array

---

## Plane IDs (populated by /pp)

Phase A: AHR-100
- Task 1: AHR-101
- Task 2: AHR-102

Phase B: AHR-103
- Task 1: AHR-104
- Task 2: AHR-105
- Task 3: AHR-106

Phase C: AHR-107
- Task 1: AHR-108
- Task 2: AHR-109
