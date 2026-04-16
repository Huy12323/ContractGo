# QueryKeys factory refactor + call-site migration

Work Item: AHR-849 (https://plane.jimbui.dev/aiur/browse/AHR-849/)
Tier 1: AHR-845 [v0.0.1 | Realtime] Org-scoped realtime sync platform (In Progress)
Module: Realtime (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/cf032c73-9fdd-40bd-87c5-0cbffbdcae52/)
Outline Spec: https://outline.jimbui.dev/doc/417b83aa-a52e-48a7-996b-8cc6e73ab1cb
Version Doc: https://outline.jimbui.dev/doc/4d630af1-7350-40c4-a614-4291881e1b64

## Context (from spec)

Non-tech: Today the frontend's TanStack Query keys are hand-rolled camelCase domain buckets. To let the realtime hook (AHR-851) invalidate caches purely by DB table name, we rewrite the factory so every key is typed against the actual `Database["public"]["Tables"]` snake_case table name and `record(id)` carries a `"record"` sentinel. **Custom access-pattern methods (`mine`/`me`/`org`/`byToken`/`preview`) were dropped entirely** (mid-execution pivot — see AHR-849 Planning Decisions on the version doc) in favor of the standard `[...list(), extraArg]` / `[...record(id), extraArg]` spread pattern from `bible-tanstack-query-mutation`. Zero deviation from spark.

Tech: Full rewrite of `frontend/vite/src/utils/query/queryKeys.ts`. New factory `createTableFactory<T extends keyof Database["public"]["Tables"]>(name: T)` returns `{ all(), list(), record(id): [name, "record", id] }`. Factory typed as `Record<TableName, ReturnType<typeof createTableFactory<TableName>>>` — all 18 tables present, completeness enforced. Domain keys rename to snake_case: `adminInvitations → admin_invitations`, `contractTemplates → contract_templates`, `employeeColumns → employee_columns`, `employeeColumnChoices → employee_column_choices`, `onboardingInvitations → onboarding_invitations`, `employeeViews → employee_views`. Unchanged: `organizations`, `profiles`, `entities`, `departments`, `employees`, `contracts`. **7 custom-method call sites rewritten to spread pattern**: `.mine()` → `[...list(), "mine"]`, `.me()` → `record(userId)` (userId via `useStore_Auth_User`), `.org(id)` → `[...list(), { organizationId }]`, `.byToken(t)` → `record(t)`, `.preview(t)` → `[...record(t), "preview"]`.

Related:
- Auth (https://outline.jimbui.dev/doc/781cc32a-ff6d-4e32-b6bc-ceb8b7e6e098) — `useQ_Me` uses `QueryKeys.profiles.me()`.
- Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — heavy QueryKeys consumer (orgs, admins, invitations).
- Employee Management (https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — biggest consumer (columns, choices, views, contracts).
- Employee Onboarding (https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b) — `onboardingInvitations` with the most custom methods (mine, org, byToken, preview).

Siblings: 7 total, 0 Done — AHR-846 (Done — local, pending /pp), AHR-847 (Planned — local), AHR-848 (Planned — local), AHR-849 (In Progress — this item), AHR-850 (Todo), AHR-851 (Todo), AHR-852 (Todo).

Execution Order: Step 2 of 4. Prerequisite AHR-846 effectively Done ✓ (this T2 has no DB dependency, it's pure frontend). Parallel with AHR-847 + AHR-848. Downstream: AHR-850 (documents this shape) and AHR-851 (consumes it for invalidation predicate).

## Phase A: Factory rewrite (pure factory — no custom methods)

- [x] Rewrote `frontend/vite/src/utils/query/queryKeys.ts` — pure 3-method factory typed against `keyof Database["public"]["Tables"]`
- [x] All 18 tables assembled as flat `Record<TableName, ReturnType<typeof createTableFactory<TableName>>>` — completeness enforced at compile time
- [x] **Mid-execution pivot: dropped all 7 custom methods** (`mine`, `me`, `org`, `byToken`, `preview`). Zero deviation from spark. Rationale captured in version doc's AHR-849 Planning Decisions.

## Phase B: Call-site migration

- [x] Mass `sed -i` across `frontend/vite/src/` — all 6 camelCase → snake_case key renames in one pass; post-sed grep returned 0 matches
- [x] Rewrote 7 custom-method call sites to spread pattern:
  - `useQ_Me.ts` — `profiles.me()` → `profiles.record(userId)` via `useStore_Auth_User()`; added `enabled: !!userId`
  - `useQ_Tables_MyOrganizations.ts` — `organizations.mine()` → `[...organizations.list(), "mine"]`
  - `useQ_Tables_MyInvitations.ts` — `admin_invitations.mine()` → `[...admin_invitations.list(), "mine"]`
  - `useQ_Tables_MyOnboardingInvitations.ts` — `onboarding_invitations.mine()` → `[...onboarding_invitations.list(), "mine"]`
  - `useQ_Tables_OrgOnboardingInvitations.ts` — `onboarding_invitations.org(orgId)` → `[...onboarding_invitations.list(), { organizationId }]`
  - `useQ_PageOnboardingFiller_InvitationByToken.ts` — `onboarding_invitations.byToken(t)` → `onboarding_invitations.record(t)`
  - `useQ_PageOnboardingFiller_InvitationPreview.ts` — `onboarding_invitations.preview(t)` → `[...onboarding_invitations.record(t), "preview"]`
- [x] Verified no positional `record(id)` consumers exist — no one destructures the returned tuple by index; all consumers spread.

## Phase C: Verification

- [x] `pnpm --filter @aiur-hr/web type-check` — passes clean, 0 errors
- [x] Collateral cleanup: removed pre-existing unused `const { token } = theme.useToken()` + `theme` import from `src/routes/_protected/route.tsx` — was already blocking type-check before AHR-849; obvious dead code.
- [ ] Browser smoke test deferred to user — `pnpm dev:web` not started from this execution (long-running shell blocker). Eyeball home / org dashboard / employees before `/pp AHR-849`.

---

## Plane IDs (populated by /pp)

Phase A: AHR-892 (Factory rewrite — pure, no custom methods)

- Task 1: AHR-893 — Rewrite queryKeys.ts with typed factory
- Task 2: AHR-894 — Assemble all 18 table entries
- Task 3: AHR-895 — Mid-flight pivot: drop 7 custom methods

Phase B: AHR-896 (Call-site migration)

- Task 1: AHR-897 — sed camelCase to snake_case across src
- Task 2: AHR-898 — Rewrite useQ_Me via useStore_Auth_User + record(userId)
- Task 3: AHR-899 — Rewrite organizations.mine to list-spread
- Task 4: AHR-900 — Rewrite admin_invitations.mine to list-spread
- Task 5: AHR-901 — Rewrite onboarding_invitations.mine to list-spread
- Task 6: AHR-902 — Rewrite onboarding_invitations.org to list-spread with organizationId
- Task 7: AHR-903 — Rewrite onboarding_invitations.byToken to record(token)
- Task 8: AHR-904 — Rewrite onboarding_invitations.preview to record-spread

Phase C: AHR-905 (Verification)

- Task 1: AHR-906 — pnpm type-check passes clean
- Task 2: AHR-907 — Collateral cleanup: remove unused theme.useToken
