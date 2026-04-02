# Light theme, navbar & sidebar restructure

Work Item: [AHR-140](https://plane.jimbui.dev/aiur/browse/AHR-140/)
Tier 1: [AHR-139](https://plane.jimbui.dev/aiur/browse/AHR-139/) [v0.0.1 | App Shell] Homepage & navbar restructure (Todo)
Module: App Shell (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/9a60fe58-e1b1-49d9-bb12-2d2f65ca73f1/)
Outline Spec: https://outline.jimbui.dev/doc/3dc2bb49-803a-4c0c-a9f2-e2b7de399a22
Version Doc: https://outline.jimbui.dev/doc/4b622bb5-c198-4e36-bbc2-0406c74680fb

## Context (from spec)

Non-tech: The app shell switches from a dark sidebar-only layout to a light-themed layout with a full-width top navbar (hamburger + logo home button + account dropdown) above a light sidebar with standard Ant Design highlight for selected pages.
Tech: `routes/_protected/route.tsx` (current layout — dark Sider + mock Header + profile card), `stores/sidebar.ts` (collapse state), `stores/auth.ts` (signOut), `api/queries/profiles.ts` (profile data for avatar). Current: Header inside inner Layout (right of Sider). New: Header wraps both Sider + Content.
Related: Organization (https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org switcher + view switcher land in sidebar bottom (AHR-141)
Siblings: 3 total, 0 Done — AHR-140 Navbar restructure (Todo), AHR-141 Org/view switcher (Todo), AHR-142 Homepage cards (Todo)
Execution Order: Step 1 of 2 — no prerequisites ✓

## Phase A: Layout hierarchy restructure

- [x] Move Header above Sider — full-width top bar
- [x] Header left: hamburger toggle → app logo as `Link` to `/home`
- [x] Header right: account avatar (initials) with hover `Dropdown` containing user name + logout
- [x] Remove profile card from sidebar bottom
- [x] Remove logo/toggle area from sidebar top — sidebar starts directly with Menu
- [x] Create `/home` route stub (placeholder for AHR-142)

## Phase B: Light theme

- [x] Switch Sider to light background (remove dark styling)
- [x] Switch Menu to `theme` default (light) — Ant Design handles selected highlight
- [x] Update sidebar borders for light theme
- [x] Header: white background, bottom border, consistent

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)

Phase B: (pending)

- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
