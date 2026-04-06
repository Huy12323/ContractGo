# Layout + org list redesign

Work Item: [AHR-290](https://plane.jimbui.dev/aiur/browse/AHR-290/)
Tier 1: [AHR-272] [v0.0.1 | Pages] Home page redesign (Todo)
Module: Pages (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/ccb49b56-1a0e-4c59-ba47-914cb3816273/)
Outline Spec: https://outline.jimbui.dev/doc/6c6f11ee-bd9d-4d03-8550-88dcdf0b3628
Version Doc: https://outline.jimbui.dev/doc/e0c1a1ec-94b8-48de-a935-fb6561aa9886

## Context (from spec)

Non-tech: Organization selector page redesigned with clamped-width container, row-based org list with Lucide icons, and streamlined header with search and create controls.
Tech: src/pages/Page_Home/Page_Home.tsx (current row layout from AHR-274). Uses useQ_Tables_MyOrganizations, useQ_Tables_MyRole, App_OrgSettingsModal, App_CreateOrgModal. Need to install lucide-react.
Related: Organization — org data hooks and settings modal
Siblings: 2 total, 0 Done — [AHR-290 Layout + org list redesign (Todo) ←, AHR-292 Frontend search filtering (Todo)]
Execution Order: Step 1 of 2 — no prerequisites (foundation)

## Phase A: Install lucide-react

- [x] Install lucide-react: `pnpm add lucide-react` in frontend/vite workspace

## Phase B: Rewrite Page_Home

- [x] Rewrite Page_Home: outer container clamped to maxWidth 640px, centered with margin auto. Header row as flex container: "My Organizations" title (left, flex:1), Input.Search with SearchOutlined prefix (center, ~200px, visual placeholder — no onChange yet, AHR-292 will add), Button with PlusOutlined icon only (right) opening App_CreateOrgModal. Remove old Typography.Title and standalone create Button
- [x] Rewrite PageHome_OrgCard: replace Avatar with Lucide `Building2` icon (size 20, secondary color). Keep org name. Keep `— members` placeholder. Replace direct MoreOutlined Button with ANTD Dropdown + horizontal ellipsis icon (Lucide `MoreHorizontal`), menu items: [{ key: 'settings', label: 'Settings' }], onClick opens App_OrgSettingsModal. Dropdown only rendered for owner role. Remove getOrgHue function and hue-based styling
- [x] Verify: loading spinner still works, empty state (no orgs) looks reasonable, create modal opens from plus button, settings modal opens from dropdown

---

## Plane IDs (populated by /pp)

Phase A: AHR-304

- Task 1: AHR-305

Phase B: AHR-306

- Task 1: AHR-307
- Task 2: AHR-308
- Task 3: AHR-309
