# [v0.0.1 | Employee Management] Employees page — table + chart > Org chart: render departments in the tree

Work Item: [AHR-639](https://plane.jimbui.dev/aiur/browse/AHR-639/)
Tier 1: [AHR-395] [v0.0.1 | Employee Management] Employees page — table + chart (Todo)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The org chart on Page_Employees currently renders only the organization root and its entities. Departments never appear because the tree builder receives an empty array — no hook fetches all-org departments. After this T2, the chart shows the full structural hierarchy: Organization → Entities → Departments → Sub-departments.
Tech: `Page_Employees.tsx` line ~144 passes `[]` to `Utils_OrgTree_BuildTree(org.name, 'org-root', entities, [])`. The tree builder (`Utils_OrgTree_BuildTree.ts`) works correctly — `buildDeptTree()` handles recursive nesting, parent_id filtering, entity_id scoping. The bug is purely data fetch. The `departments` table has `organization_id` (direct column, not a join) so a simple `SELECT ... WHERE organization_id = ?` suffices. Existing `useQ_Tables_EntityDepartments` fetches per-entity; we need a new `useQ_Tables_OrgDepartments` that fetches all departments for the org.
Related: [Employee Onboarding](https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b) — the onboarding flow creates `rel__department__employee` rows that link employees to departments. Those employees will hang under these department nodes when AHR-641 (employee chart leaf nodes) lands.
Siblings: 6 total, 0 Done, 3 Cancelled — [AHR-401 page layout (Cancelled), AHR-402 list view (Cancelled), AHR-403 chart view (Cancelled), AHR-639 Org chart departments (Todo) ←, AHR-640 Employee data table (Todo), AHR-641 Employee chart nodes (Todo)]
Execution Order: Step 1 of 2 — no prerequisites, this is the foundation

## Phase A: Data layer — fetch all org departments

- [x] Create `frontend/vite/src/hooks/useQ_Tables_OrgDepartments.ts` — queries `departments WHERE organization_id = organizationId`, ordered by `created_at asc`, keyed by `[...QueryKeys.departments.list(), { organizationId }]`. Returns `{ query, departments }`.

## Phase B: Wire into Page_Employees

- [x] In `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx`: imported `useQ_Tables_OrgDepartments`, called alongside `qEntities`, replaced `[]` with `qDepartments.departments` in `Utils_OrgTree_BuildTree(...)`, added to `useMemo` deps.
- [x] Verify: tree builder receives real department data. `buildDeptTree()` filters by `entity_id` and `parent_id` to nest correctly. Department-create mutation invalidates `departments.all()` which prefix-matches the hook's key (confirmed by earlier key-mismatch fix). Manual browser verification deferred to user.
- [x] Type-check: `npx tsc --noEmit` clean — only the same 4 pre-existing errors.

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
