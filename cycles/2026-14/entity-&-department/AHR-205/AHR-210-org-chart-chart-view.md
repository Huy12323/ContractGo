# Org chart page — chart view

Work Item: [AHR-210](https://plane.jimbui.dev/aiur/browse/AHR-210/)
Tier 1: [AHR-205](https://plane.jimbui.dev/aiur/browse/AHR-205/) [v0.0.1 | Entity & Department] Entity & department management via org chart (In Progress)
Module: Entity & Department (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/627baa9a-bdeb-475a-83f5-70ef95fb830b/)
Outline Spec: https://outline.jimbui.dev/doc/93f24648-a9da-4b57-b51b-31db58d94a0f
Version Doc: https://outline.jimbui.dev/doc/0eb755a4-0002-428d-b119-09b772612683
Roadmap Feature: Entity Management (https://outline.jimbui.dev/doc/e7f99a59-2d14-4a9c-a66f-453cdc465524), Department Management (https://outline.jimbui.dev/doc/9e890394-bae6-4704-98d9-e291c9903726)

## Context (from spec)

Non-tech: Interactive org chart page showing the organization structure as a top-down tree: Organization → Entities → Departments (recursive). Admins can create/edit/delete entities and departments from the chart. Design adapts from AIUR demo mockup but layout details may vary.
Tech: New route `routes/_protected/$organizationId/org-chart/index.tsx`, sidebar menu item in `routes/_protected/route.tsx`. Queries: `useQ_Tables_OrgEntities`, `useQ_Tables_EntityDepartments`, `useQ_Tables_EntityEmployees` (from AHR-209). Modals: `App_EntitySettingsModal`, `App_DepartmentSettingsModal`, `App_EntityCreate` (from AHR-209). Demo reference: `C:\Coding\aiur\aiur--demo\frontend\vite\src\demos\demo-aiur-hr\Demo_AiurHR_OrgChart.tsx` — layout algorithm, zoom/pan, node cards, SVG connectors. Tree builder utility needed to convert flat Supabase data → recursive tree.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org context from Provider_Organization, App Shell sidebar
Siblings: 4 active, 2 Done (local) — AHR-208 Schema (Done local), AHR-209 Modals (Done local), AHR-210 Chart view (Todo), AHR-211 List view (Todo)
Execution Order: Step 3 of 3 — AHR-208 + AHR-209 done (local) ✓

## Phase A: Route + sidebar integration

- [x] Create `routes/_protected/$organizationId/org-chart/index.tsx` — page component with header (title + zoom controls + add entity button) and chart canvas area
- [x] Add "Org Chart" menu item to sidebar in `routes/_protected/route.tsx` (ApartmentOutlined icon, alongside Dashboard)

## Phase B: Data layer — tree builder

- [x] Create tree builder utility (`utils/Utils_OrgTree_BuildTree.ts`) — converts flat entities + departments arrays into a recursive tree structure for rendering. Root = organization node, children = entities, each entity's children = departments (recursive via parent_id)
- [x] Include entity employee heads in entity nodes (from `useQ_Tables_EntityEmployees`) for avatar display
- [x] Compose data in the org chart page: fetch entities + departments + entity employees, build tree, memoize

## Phase C: Chart layout engine + rendering

- [x] Adapt layout algorithm from demo — `computeLayout`, `measureSubtreeWidth`, `positionSubtree`, `positionVertical` functions. Extract to utility or keep in page depending on size. Node sizing by depth level
- [x] Node card component — shows name, employee/dept count tag, head avatars with presence. Visual distinction between entity and department nodes (e.g., different accent or border). Adapt from demo's OrgCard pattern
- [x] SVG bezier connector lines between parent-child nodes
- [x] Zoom controls (in/out/fit buttons + scroll-to-zoom), pan (drag canvas), initial fit-to-view on mount
- [x] Expand/collapse toggle button on nodes with children, anchor preservation on toggle
- [x] Dot-grid canvas background

## Phase D: Chart interactions — CRUD + modals

- [x] Click entity node → open `App_EntitySettingsModal` (from AHR-209)
- [x] Click department node → open `App_DepartmentSettingsModal` (from AHR-209)
- [x] "Add Entity" button in page header → entity creation modal/form (name required, uses `useM_EntitySettings_EntityCreate`)
- [x] "Add Department" action on entity/department nodes → department creation modal/form (name + entity/parent context pre-filled, uses `useM_DeptSettings_DepartmentCreate`)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)

Phase C: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)

Phase D: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
