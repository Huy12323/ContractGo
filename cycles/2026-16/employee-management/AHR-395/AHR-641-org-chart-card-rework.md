# [v0.0.1 | Employee Management] Employees page — table + chart > Org chart card rework: styled cards with employee/manager display

Work Item: [AHR-641](https://plane.jimbui.dev/aiur/browse/AHR-641/)
Tier 1: [AHR-395] [v0.0.1 | Employee Management] Employees page — table + chart (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Restyle the org chart from plain cards to mockup-style design: colored label headers per level (semantic colors — Primary/Info/Success), white card body, uniform 300px width. Department cards always show their managers. Tree uses CSS flex layout (not computed absolute positioning) so cards wrap content naturally. Connectors use straight CSS div lines. Drag-to-pan + scroll-to-zoom with anchor preservation on expand/collapse.
Tech: Full refactor of Page_Employees chart rendering. Removed the entire JS layout algorithm (computeLayout, positionSubtree, positionVertical, etc.) and SVG connectors. Replaced with recursive `renderNode` flex component + CSS div connectors with half-bar approach for horizontal rails. Added `useQ_Tables_OrgEmployeesWithDepartments` hook with `peopleByDeptId` (split by `is_manager`). Anchor preservation via `data-node-id` DOM query + scroll adjustment after re-render.
Related: [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — AHR-642/643 added `is_manager` to `rel__department__employee`, enabling the manager display.
Siblings: 3 active, 1 Done — [AHR-639 Org chart departments (Done local), AHR-640 Employee data table (Todo), AHR-641 Card rework (Done local) ←]
Execution Order: Step 2 of 2 — AHR-639 (data fix) was prerequisite, done.

## Phase A: Flex layout refactor

- [x] Remove the entire JS layout algorithm (computeCardHeight, computeLayout, measureSubtreeWidth, positionSubtree, positionVertical, flattenLayout, collectEdges, buildTreeLayout) and SVG connector rendering
- [x] Create recursive `renderNode(node, depth)` function using CSS flex layout — cards wrap content naturally, no explicit height
- [x] CSS div connectors: vertical bars from parent to children, horizontal rails built from overlapping half-bars per child (works with varying subtree widths)
- [x] Connector color: `token.colorBorder` at opacity 1 (no overlap artifacts at junctions)

## Phase B: Card styling

- [x] Uniform 300px card width for all levels
- [x] Colored label header (Primary for org, Info for entity, Success for departments + sub-departments) with white text showing node name + type label
- [x] White card body (`colorBgContainer`) with level-specific content: org shows entity count, entity shows department count, departments always show managers section
- [x] Department manager display: always visible "Managers" label + list of managers with avatar initials. Shows "No managers assigned" when empty. Uses `is_manager` from `rel__department__employee`

## Phase C: Interaction fixes

- [x] Drag-to-pan via scroll position manipulation (`scrollLeft`/`scrollTop`) instead of removed `transform: translate`
- [x] `overflow: hidden` on viewport — no scrollbars, no competing scroll interactions. Only drag-to-pan + scroll-to-zoom
- [x] `userSelect: none` on viewport to prevent text selection during pan
- [x] `didDrag` ref suppresses card clicks after pan gestures (only stationary clicks open settings modals)
- [x] Anchor preservation: captures card screen position before expand/collapse, adjusts scroll after re-render so the card stays in place
- [x] Zoom toolbar positioned as absolute overlay (not sticky inside scrollable area)
- [x] Auto-expand entities on data load + auto-expand parent on department creation

## Phase D: Data layer

- [x] Updated `useQ_Tables_OrgEmployeesWithDepartments` to fetch `is_manager` from `rel__department__employee`
- [x] Added `peopleByDeptId` grouping: splits managers from employees per department for O(1) lookup

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)

Phase B: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)

Phase C: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)
- Task 7: (pending)

Phase D: (pending)
- Task 1: (pending)
- Task 2: (pending)
