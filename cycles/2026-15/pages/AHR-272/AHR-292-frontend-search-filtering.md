# Frontend search filtering

Work Item: [AHR-292](https://plane.jimbui.dev/aiur/browse/AHR-292/)
Tier 1: [AHR-272] [v0.0.1 | Pages] Home page redesign (In Progress)
Module: Pages (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/ccb49b56-1a0e-4c59-ba47-914cb3816273/)
Outline Spec: https://outline.jimbui.dev/doc/6c6f11ee-bd9d-4d03-8550-88dcdf0b3628
Version Doc: https://outline.jimbui.dev/doc/e0c1a1ec-94b8-48de-a935-fb6561aa9886

## Context (from spec)

Non-tech: Search input in the home page header filters the organization list by name. Frontend-only, instant, case-insensitive.
Tech: src/pages/Page_Home/Page_Home.tsx — search Input already exists (visual placeholder from AHR-290). Organizations come from useQ_Tables_MyOrganizations hook. Need to add state + filtering logic + no-results empty state.
Related: None — self-contained in Page_Home
Siblings: 2 total, 1 Done (local) — [AHR-290 Layout + org list redesign (Done, local), AHR-292 Frontend search filtering (Todo) ←]
Execution Order: Step 2 of 2 — AHR-290 done (local) ✓

## Phase A: Wire search filtering

- [x] Add `searchQuery` state to Page_Home. Wire `onChange` on the existing search Input to update it. Derive `filteredOrganizations` from `qOrganizations.organizations` filtered by `org.name.toLowerCase().includes(searchQuery.toLowerCase())`. Pass filtered list to the org row map
- [x] Add no-results empty state: when `filteredOrganizations` is empty AND `searchQuery` is non-empty, show ANTD Empty with "No organizations match your search" message. Keep existing empty state for when there are genuinely no orgs

---

## Plane IDs (populated by /pp)

Phase A: AHR-310

- Task 1: AHR-311
- Task 2: AHR-312
