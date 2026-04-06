# Protected pages extraction + URL restructuring

Work Item: [AHR-274](https://plane.jimbui.dev/aiur/browse/AHR-274/)
Tier 1: [AHR-271] [v0.0.1 | Pages] Route structure refactoring (In Progress)
Module: Pages (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/ccb49b56-1a0e-4c59-ba47-914cb3816273/)
Outline Spec: https://outline.jimbui.dev/doc/6c6f11ee-bd9d-4d03-8550-88dcdf0b3628
Version Doc: https://outline.jimbui.dev/doc/e0c1a1ec-94b8-48de-a935-fb6561aa9886

## Context (from spec)

Non-tech: Extract 3 protected pages into src/pages/ and restructure URLs: /home → /, /$orgId/dashboard → /$orgId/.
Tech: routes/_protected/home/index.tsx (263 lines, org selector), routes/_protected/$organizationId/dashboard/index.tsx (9 lines, empty), routes/_protected/$organizationId/org-chart/index.tsx (501 lines, canvas). Layout routes stay in routes/. References to /home in: routes/index.tsx, _protected/route.tsx, $organizationId/route.tsx. References to /dashboard in: _protected/route.tsx (sidebar), App_OrgSwitcher.tsx, home/index.tsx.
Related: Auth — auth layout beforeLoad already updated to `/` in AHR-273
Siblings: 2 total, 1 Done — [AHR-273 Auth pages extraction (Done), AHR-274 Protected pages + URL restructuring (Todo) ←]
Execution Order: Step 2 of 2 — AHR-273 done ✓

## Phase A: Extract page components

- [x] Create `src/pages/Page_Home/Page_Home.tsx` — move home page logic from _protected/home/index.tsx. Rename internal OrgCard to PageHome_OrgCard. Update navigate target from `/$organizationId/dashboard` to `/$organizationId`
- [x] Create `src/pages/Page_Organization/Page_Organization.tsx` — move DashboardPage from $organizationId/dashboard/index.tsx, rename to Page_Organization
- [x] Create `src/pages/Page_OrgChart/Page_OrgChart.tsx` — move OrgChartPage + all layout algorithm functions/types/constants from $organizationId/org-chart/index.tsx (keep everything in one file)

## Phase B: Route file restructuring

- [x] Delete `routes/index.tsx` (root redirect — no longer needed)
- [x] Create `routes/_protected/index.tsx` — thin wrapper importing Page_Home, route path `/_protected/` (serves `/`)
- [x] Delete `routes/_protected/home/` folder
- [x] Create `routes/_protected/$organizationId/index.tsx` — thin wrapper importing Page_Organization, route path `/_protected/$organizationId/` (serves `/$orgId/`)
- [x] Delete `routes/_protected/$organizationId/dashboard/` folder
- [x] Update `routes/_protected/$organizationId/org-chart/index.tsx` — thin wrapper importing Page_OrgChart

## Phase C: Navigation reference updates

- [x] Update `routes/_protected/route.tsx`: `isHome` check from `/home` to `/`, `Link to="/home"` to `Link to="/"`, sidebar menu keys and links from `/dashboard` to `/$organizationId`, menu link `to="/$organizationId/dashboard"` to `to="/$organizationId"`
- [x] Update `routes/_protected/$organizationId/route.tsx`: two `redirect({ to: '/home' })` to `redirect({ to: '/' })`
- [x] Update `components/organization/App_OrgSwitcher.tsx`: navigate from `/$organizationId/dashboard` to `/$organizationId`

---

## Plane IDs (populated by /pp)

Phase A: AHR-287

- Task 1: AHR-288
- Task 2: AHR-289
- Task 3: AHR-291

Phase B: AHR-293

- Task 1: AHR-294
- Task 2: AHR-295
- Task 3: AHR-296
- Task 4: AHR-297
- Task 5: AHR-298
- Task 6: AHR-299

Phase C: AHR-300

- Task 1: AHR-301
- Task 2: AHR-302
- Task 3: AHR-303
