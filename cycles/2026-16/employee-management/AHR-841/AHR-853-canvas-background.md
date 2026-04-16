# Canvas background — pannable dot grid

Work Item: AHR-853 (https://plane.jimbui.dev/aiur/browse/AHR-853/)
Tier 1: AHR-841 [v0.0.1 | Employee Management] Org chart view polish — canvas freedom + card refinements (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Make the chart's dot grid background pan with the chart content and scale with zoom, plus bump visibility so it's actually noticeable. Today the dots are applied to the unchanging outer viewport so they sit still while content glides over them — a "dead" feel — and they're so faint (near-white at ~14% alpha) they barely register. Target feel: Miro / FigJam / React Flow style — the grid anchors to the content, creating the sense of moving over graph paper.

Tech: Three-line style change on the outer viewport div in `Page_Employees.tsx:421-428`. Uses the `pan` and `zoom` state introduced by AHR-842 (already shipped locally). (a) `backgroundSize` becomes `\`${24 * zoom}px ${24 * zoom}px\`` so the grid cell scales with zoom. (b) Add `backgroundPosition: \`${pan.x}px ${pan.y}px\`` so the grid origin pans with content. (c) Gradient color swap from `${token.colorBorderSecondary}25` (~14% alpha of near-white `#f0f0f0`) to `${token.colorTextQuaternary}` (native `rgba(0,0,0,0.25)` on light theme) plus dot radius 1px → 1.2px. No new files, no new state, no restructuring.

Related: AHR-842 (Truly-infinite transform pan) — introduced the `pan` and `zoom` state this T2 binds to. If AHR-842's state shape ever changed, this T2 would need sync. AHR-843 and AHR-844 both modify the inner card render path — disjoint from the outer viewport's style prop here, no conflict.

Siblings: 4 total, 0 Done — AHR-842 Truly-infinite transform pan (In Progress, code-complete locally — 11/12 [x]), AHR-843 Card icon system (In Progress, code-complete locally — 8/9 [x] + post-impl ShopOutlined→BranchesOutlined swap), AHR-844 Department card body simplification (In Progress, code-complete locally — 5/6 [x]), AHR-853 (this — about to go In Progress).

Execution Order: Step 2 of 2 — AHR-842 (Step 1 dep) effectively complete (code landed, `pan`/`zoom` state exists in `Page_Employees.tsx`). AHR-843 is the other Step-2 item on a disjoint surface; no blocker.

## Phase A: Pannable, scalable, more-visible dot grid

- [x] Locate the outer viewport `style` prop in `Page_Employees.tsx` (currently around lines 421-428 — the div with `ref={viewportRef}` just inside the chart-mode block)
- [x] Change `backgroundSize: '24px 24px'` to `` backgroundSize: `${24 * zoom}px ${24 * zoom}px` `` (template literal so it re-renders on zoom change)
- [x] Add a new style property `` backgroundPosition: `${pan.x}px ${pan.y}px` `` immediately after `backgroundSize`. This is what makes the grid pan with content
- [x] Swap the gradient color token in the `background` string — change `${token.colorBorderSecondary}25` to `${token.colorTextQuaternary}` (drop the `25` hex-alpha suffix entirely — `colorTextQuaternary` is rgba and already carries its own opacity). In the same string, bump the two `1px` values to `1.2px` (dot radius)
- [x] `pnpm tsc --noEmit` from `frontend/vite/` — expect no new errors (the one pre-existing unused-var in `_protected/route.tsx` is unrelated)
- [ ] Manual browser smoke on `/employees` chart mode: drag the chart, verify the dot grid translates along with the content (not staying fixed); wheel zoom in/out, verify individual dots get larger/smaller; visibility check — dots are clearly present but not distracting; repeat check on dark theme if available

---

## Plane IDs (populated by /pp)

Phase A: AHR-981 — Pannable, scalable, more-visible dot grid + perf fix + toggle

- Task 1: AHR-982
- Task 2: AHR-983
- Task 3: AHR-984
- Task 4: AHR-985
- Task 5: AHR-986
- Task 6: AHR-987
