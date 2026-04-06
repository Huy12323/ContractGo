# [v0.0.1 | Database] Schema audit remediation > Drop RBAC infrastructure

Work Item: [AHR-321](https://plane.jimbui.dev/aiur/browse/AHR-321/)
Tier 1: [AHR-314] [v0.0.1 | Database] Schema audit remediation (Todo)
Module: [Database](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: n/a (no Database spec doc yet)
Version Doc: n/a (no v0.0.1 version doc yet)

## Context (from spec)

Non-tech: Remove the unused permission system (organization_role_permissions table and related functions) that was built but never enforced. Will be reintroduced later when needed.
Tech: Migration drops `organization_role_permissions` table, `app_permission` enum, `authorize()` + `seed_org_permissions()` functions, updates `create_organization()` RPC. Frontend removes `App_PermissionGuard.tsx`, `useQ_Tables_OrgPermissions.ts`, strips permission fields from `useOrganization` hook. Role system (`get_org_role`, `is_org_member`, `is_admin_or_owner`, `App_RoleGuard`, `useQ_Tables_MyRole`) stays intact.
Related: AHR-323 (Rename org_ tables) — will later update helper functions that reference membership tables. This T2 must NOT touch those functions beyond removing the `seed_org_permissions` call from `create_organization()`.
Siblings: 6 total, 0 Done — [AHR-320 Drop currencies (Not started), AHR-321 Drop RBAC (Not started), AHR-322 Drop identifier (Not started), AHR-323 Rename org_ tables (Not started), AHR-324 Drop entity_employees (Not started), AHR-325 Add FK on child org_id (Not started)]
Execution Order: Step 1 of 3 — no prerequisites (parallel with AHR-320 + AHR-322)

## Phase A: Database Migration — Drop RBAC Objects

- [x] Write migration: drop 4 RLS policies on `organization_role_permissions`
- [x] Write migration: replace `create_organization()` — remove `seed_org_permissions()` call
- [x] Write migration: drop `authorize(text, app_permission)` function
- [x] Write migration: drop `seed_org_permissions(text)` function
- [x] Write migration: drop `organization_role_permissions` table
- [x] Write migration: drop `app_permission` enum type
- [x] Apply migration locally (`supabase db push --local`)
- [x] Run `supabase db lint --local`

## Phase B: Frontend — Remove RBAC Components & Hooks

- [x] Delete `src/components/auth/App_PermissionGuard.tsx`
- [x] Delete `src/hooks/useQ_Tables_OrgPermissions.ts`
- [x] Strip `useOrganization` hook: remove `useQ_Tables_OrgPermissions` import, `AppPermission` type, `qPermissions`, `permissions`, `permissionSet`, `hasPermission`, and `qPermissions.query.isLoading` from loading check
- [x] Verify no remaining references to deleted exports

## Phase C: Type Regeneration & Verification

- [x] Regenerate `database.types.ts` (`pnpm sb:dev:types`)
- [x] Verify TypeScript compiles cleanly (`pnpm tsc --noEmit`)
- [ ] Verify app runs: login, org switching, admin operations work without RBAC

---

## Plane IDs (populated by /pp)

Phase A: AHR-342

- Task 1: AHR-343
- Task 2: AHR-344
- Task 3: AHR-345
- Task 4: AHR-346
- Task 5: AHR-347
- Task 6: AHR-348
- Task 7: AHR-349
- Task 8: AHR-350
Phase B: AHR-351
- Task 1: AHR-352
- Task 2: AHR-353
- Task 3: AHR-354
- Task 4: AHR-355
Phase C: AHR-356
- Task 1: AHR-357
- Task 2: AHR-358
- Task 3: AHR-359
