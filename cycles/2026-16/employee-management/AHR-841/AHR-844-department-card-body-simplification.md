# Department card body simplification

Work Item: AHR-844 (https://plane.jimbui.dev/aiur/browse/AHR-844/)
Tier 1: AHR-841 [v0.0.1 | Employee Management] Org chart view polish — canvas freedom + card refinements (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Streamline the department card so the managers list sits directly under the colored header — no more redundant "Managers (N)" row with a gear icon. Empty state ("No managers assigned") text and color stay as-is; the only other adjustment is a 4px top padding on the body wrapper to give the new first row some breathing room under the colored header.

Tech: Single-file edit, `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx`. Target is the `{isDept && ...}` block inside `renderNode` (currently lines 277-297). Delete the header `<div>` containing `<SettingOutlined />` + `<span>Managers(N)</span>` (lines 280-283). Add `paddingTop: 4` to the outer `borderTop` wrapper (line 279). No new files, no state, no hooks, no schema. `SettingOutlined` import stays (still used by the "Manage Fields" button at line 313).

Related: AHR-843 (Card icon system — level + count icons) modifies the colored header (lines 257-261) and the org/entity body count lines. Independent surface from this T2's body simplification; the two changes will merge cleanly.

Siblings: 4 total, 0 Done — AHR-842 Truly-infinite transform pan (In Progress, partially implemented — 11/12 tasks [x], pending manual smoke verification), AHR-843 Card icon system (Not started), AHR-853 Canvas background (Not started), AHR-844 (this — about to go In Progress).

Execution Order: Step 1 of 2 — parallel-safe with AHR-842; no prerequisites. AHR-843 depends on this step completing (shares the card render path).

## Phase A: Simplify department card body

- [x] Delete the `SettingOutlined` + "Managers (N)" header `<div>` inside the `{isDept && ...}` body wrapper (currently `Page_Employees.tsx:280-283`). Keep the outer wrapper (the one with `borderTop`) and everything below it (manager rows map + empty-state div)
- [x] Add `paddingTop: 4` to the outer `borderTop` wrapper's inline style (`Page_Employees.tsx:279`). Existing `borderTop: 1px solid ${token.colorBorderSecondary}` stays; just add the new property alongside it
- [x] Verify no other code depends on the removed header row — grep for "Managers" string in `Page_Employees.tsx` (only expected hit is the deleted span itself); grep for other `SettingOutlined` usage (should find the "Manage Fields" button at line 313 — that stays, import stays)
- [x] Verify sub-department count requirement is already satisfied — confirm the dept body renders no count today (managers only). No code change; just a verification checkpoint so future planners don't look for something that was never there
- [x] Run `pnpm tsc --noEmit` from `frontend/vite/` — expect no new errors (the one pre-existing unused-var in `_protected/route.tsx` is unrelated)
- [ ] Manual browser smoke on `/employees` chart mode: department card shows managers list directly under the colored header with no gear icon; empty state shows "No managers assigned" with unchanged text + color; padding feels uniform between the colored header and the first manager row / empty-state text

---

## Plane IDs (populated by /pp)

Phase A: AHR-962 — Simplify department card body

- Task 1: AHR-963
- Task 2: AHR-964
- Task 3: AHR-965
- Task 4: AHR-966
- Task 5: AHR-967
- Task 6: AHR-968
