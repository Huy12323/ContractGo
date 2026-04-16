# Truly-infinite transform pan

Work Item: AHR-842 (https://plane.jimbui.dev/aiur/browse/AHR-842/)
Tier 1: AHR-841 [v0.0.1 | Employee Management] Org chart view polish — canvas freedom + card refinements (Todo)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Replace the chart's native-scroll pan with a truly-infinite transform-based pan so users can drag the org chart freely in any direction without hitting an arbitrary border. Initial render auto-fits the chart so it lands centered + sized to the viewport on load. Wheel zoom anchors at the cursor (Figma-style); toolbar zoom buttons anchor at the viewport center.

Tech: All changes scoped to `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx` (chart-mode block ~lines 326–372 + handlers + the toggle-anchor `useEffect`). One new file: `frontend/vite/src/pages/Page_Employees/utils_PageEmployees_CanvasTransform.ts` exposing two pure helpers (`computeFitTransform`, `applyZoomAnchored`). No schema, no hooks, no query changes, no other files touched.

Related: `frontend/vite/src/pages/Page_OrgChart/Page_OrgChart.tsx` — reference implementation pattern for transform-based pan + `didInitialFit.current` mount fit + anchorRef preservation. Differs from Page_Employees because it uses absolute-positioned layout (computed canvasW/H), while Page_Employees uses flex layout (auto-sized) — anchor preservation here keeps screen-coord capture, not layout-coord.

Siblings: 3 total, 0 Done — AHR-842 Truly-infinite transform pan (this — Todo), AHR-843 Card icon system — level + count icons (Todo, sequenced after AHR-844), AHR-844 Department card body simplification (Todo, parallel-safe with this).

Execution Order: Step 1 of 2 — parallel-safe with AHR-844; AHR-843 depends on AHR-844 completing.

## Phase A: Switch pan model from native-scroll to transform-translate

- [x] Add `pan: { x: number, y: number }` state (initial `{ x: 0, y: 0 }`) and `innerRef: React.RefObject<HTMLDivElement>` ref attached to the chart inner wrapper
- [x] Replace inner wrapper styling — drop `transform: scale(${zoom})`, `transformOrigin: 'top center'`, `padding: ${CONNECTOR_HEIGHT}px ${GAP_X}px`, `display: 'inline-flex'`, `minWidth: '100%'`, `justifyContent: 'center'`. Apply `position: 'absolute', top: 0, left: 0, transform: \`translate(${pan.x}px, ${pan.y}px) scale(${zoom})\`, transformOrigin: '0 0', display: 'inline-flex'` instead. Outer viewport keeps `width: '100%', height: '100%', overflow: 'hidden', position: 'relative', cursor: 'grab', userSelect: 'none'` and the radial dot grid background
- [x] Update `handleMouseDown` — store `panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }`. Drop the `scrollX/scrollY` capture from the ref shape
- [x] Update `handleMouseMove` — `setPan({ x: panStart.current.panX + (e.clientX - panStart.current.x), y: panStart.current.panY + (e.clientY - panStart.current.y) })`. Drop the `viewportRef.current.scrollLeft = ...` / `scrollTop = ...` mutations
- [x] Update the `panStart` ref's TypeScript shape to `{ x: number; y: number; panX: number; panY: number }` (no more `scrollX/scrollY`); remove every other `viewportRef.current?.scrollLeft` / `scrollTop` read or write across the component

## Phase B: Auto-fit on mount, fit-to-view, and anchor preservation in transform space

- [x] Create `frontend/vite/src/pages/Page_Employees/utils_PageEmployees_CanvasTransform.ts` exporting two pure helpers — `computeFitTransform({ vpW, vpH, contentW, contentH, zoomMin, zoomMax, margin }): { zoom, pan }` (returns the zoom that fits the content into the viewport with the given margin and the pan that centers it) and `applyZoomAnchored({ prevPan, prevZoom, newZoom, anchor }): { x: number, y: number }` (given an anchor in viewport coords, returns new pan that keeps the logical point under the anchor stable). Both are pure — no React imports
- [x] Rewrite `handleFit` body — read `viewportRef.current.clientWidth/clientHeight` for vp dims; read `innerRef.current.offsetWidth/offsetHeight` for pre-transform content dims; call `computeFitTransform`; `setZoom(...)` + `setPan(...)`
- [x] Add `didInitialFit = useRef(false)` and a `useEffect` (deps `[tree, qDepartments.departments]` or equivalent that fires after the chart has nodes) that runs once: if `!didInitialFit.current && innerRef.current?.offsetWidth > 0` → set `didInitialFit.current = true` and run the same logic as `handleFit`
- [x] Replace the toggle-anchor `useEffect` body — keep capturing `getBoundingClientRect()` on the toggled node in `handleToggle`; in the post-render effect compute `dx = newRect.left - screenX, dy = newRect.top - screenY`, then `setPan(prev => ({ x: prev.x - dx, y: prev.y - dy }))`. Inverse direction vs the old `scrollLeft += dx` (pan moves content; scroll moves view)

## Phase C: Wheel zoom anchored at cursor (toolbar buttons → viewport center)

- [x] Update `handleWheel` — read `viewportRef.current.getBoundingClientRect()`; compute anchor `{ x: e.clientX - vpRect.left, y: e.clientY - vpRect.top }`; compute `newZoom = clamp(zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP), ZOOM_MIN, ZOOM_MAX)`; if `newZoom !== zoom` → `setPan(applyZoomAnchored({ prevPan: pan, prevZoom: zoom, newZoom, anchor }))` then `setZoom(newZoom)`
- [x] Update Zoom-in / Zoom-out toolbar button handlers — same logic but anchor at viewport center: `anchor = { x: vpRect.width / 2, y: vpRect.height / 2 }`. Use `setZoom((z) => { const nz = clamp(z ± ZOOM_STEP, ZOOM_MIN, ZOOM_MAX); if (nz !== z) setPan(applyZoomAnchored(...)); return nz })` or compute zoom outside setZoom for clarity
- [ ] Smoke verification (no automated tests): manual check that drag works in all directions without bound, wheel zoom keeps the cursor point stable, toolbar zoom keeps the viewport center stable, "Fit to view" recenters + autozooms, expand/collapse keeps the toggled node visually anchored, initial load shows the chart centered + sized

---

## Plane IDs (populated by /pp)

Phase A: AHR-947 — Switch pan model

- Task 1: AHR-948
- Task 2: AHR-949
- Task 3: AHR-950
- Task 4: AHR-951
- Task 5: AHR-952

Phase B: AHR-953 — Auto-fit on mount + fit-to-view + anchor preservation

- Task 1: AHR-954
- Task 2: AHR-955
- Task 3: AHR-956
- Task 4: AHR-957

Phase C: AHR-958 — Wheel zoom anchored at cursor

- Task 1: AHR-959
- Task 2: AHR-960
- Task 3: AHR-961
