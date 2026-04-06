# Sidebar org switcher & view switcher

Work Item: [AHR-141](https://plane.jimbui.dev/aiur/browse/AHR-141/)
Tier 1: [AHR-139](https://plane.jimbui.dev/aiur/browse/AHR-139/) [v0.0.1 | App Shell] Homepage & navbar restructure (In Progress)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The sidebar bottom gains an org switcher dropdown (list of joined orgs with active indicator) and a static Admin/Employee view toggle placeholder. Selecting an org navigates to that org's dashboard. The org context is URL-driven (`/$organizationId/...`), not store-driven.
Tech: `routes/_protected/route.tsx` (sidebar layout — reserved area at line 172), `hooks/useOrganization.ts` (currently auto-selects first org — needs param), `routes/_protected/dashboard/` (moves to `$organizationId/dashboard/`), `routes/_protected/home/index.tsx` (org cards link to `/{orgId}/dashboard`), `hooks/useQ_Tables_MyOrganizations.ts` (org list for dropdown). New: `routes/_protected/$organizationId.tsx` (layout route with membership guard).
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org membership, roles, RPC functions consumed by org switcher
Siblings: 3 total, 2 Done — AHR-140 Light theme/navbar (Done), AHR-142 Homepage cards (Done)
Execution Order: Step 2 of 2 — AHR-140 done, all prerequisites met

## Phase A: Route restructuring & org context wiring

- [x] Create `routes/_protected/$organizationId.tsx` layout route — `beforeLoad` validates org membership (query `get_my_member_organizations` RPC, check orgId is in list, redirect to `/home` if not), component renders `<Outlet />`
- [x] Create `routes/_protected/$organizationId/dashboard/index.tsx` — move existing dashboard page content, read `organizationId` from `Route.useParams()` with `from: '/_protected/$organizationId'`
- [x] Delete old `routes/_protected/dashboard/` route
- [x] Update `useOrganization(organizationId: string)` — replace auto-first-org with explicit param, keep role/permissions/hasPermission logic unchanged
- [x] Update home page (`routes/_protected/home/index.tsx`) — org card click navigates to `/$organizationId/dashboard` instead of current behavior
- [x] Update `_protected/route.tsx` — remove `useOrganization()` call and org loading spinner, sidebar menu items become conditional (only show org-scoped items like Dashboard when inside an org route, using `useMatch` with `shouldThrow: false` to detect `$organizationId`)

## Phase B: Sidebar org switcher

- [x] Create `App_OrgSwitcher` component (`components/organization/App_OrgSwitcher.tsx`) — uses `useQ_Tables_MyOrganizations()` for org list, reads current org ID from URL via `useMatch`, renders current org name/avatar as trigger
- [x] Dropdown/popover content: list of joined orgs with active indicator (checkmark or highlight for current), click navigates to `/{orgId}/dashboard`
- [x] Handle collapsed sidebar — show org initial/icon as popover trigger, expanded shows full org name
- [x] Wire `App_OrgSwitcher` into `_protected/route.tsx` sidebar bottom area (replacing reserved comment)

## Phase C: View switcher mock

- [x] Create static `App_ViewSwitcherMock` component (`components/app-shell/App_ViewSwitcherMock.tsx`) — ANTD Segmented with "Admin" and "Employee" options, disabled/non-interactive, dimmed styling
- [x] Wire into sidebar above org switcher in `_protected/route.tsx`

---

## Plane IDs (populated by /pp)

Phase A: AHR-190

- Task 1: AHR-191
- Task 2: AHR-192
- Task 3: AHR-193
- Task 4: AHR-194
- Task 5: AHR-195
- Task 6: AHR-196

Phase B: AHR-197

- Task 1: AHR-198
- Task 2: AHR-199
- Task 3: AHR-200
- Task 4: AHR-201

Phase C: AHR-202

- Task 1: AHR-203
- Task 2: AHR-204
