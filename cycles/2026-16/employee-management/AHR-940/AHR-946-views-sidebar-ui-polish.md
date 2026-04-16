# Views sidebar UI polish — borderless search + new-view button

Work Item: [AHR-946](https://plane.jimbui.dev/aiur/browse/AHR-946/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Polish the top-of-sidebar block in the views sidebar. Search input becomes flat/borderless, "New View" becomes a borderless icon-only `+` button with a "Create new view" tooltip, and the two sit side-by-side instead of stacked vertically. Final touch after the empty-state work (AHR-942) made the sidebar otherwise complete.

Tech: One file — `PageEmployees_ViewsSidebar.tsx`. Only the "views exist" return branch. Container changes from `flexDirection: column` + Input + Button to a horizontal flex row. Input adds `variant="borderless"` and drops `size="small"`; Button becomes `type="text" icon={<PlusOutlined />}` wrapped in a `<Tooltip title="Create new view">`. A subtle `borderBottom` on the top container preserves visual layering against the list below. No schema changes, no hook changes, no other files touched.

Related: AHR-942 (empty-state for zero views) — landed first and introduced the sidebar shell / empty-state / loading branches that this T2 leaves alone. AHR-946 is strictly the "views exist" branch polish.

Siblings: 6 total, 5 Done (local, pending /pp) — AHR-941 Auto-save + toolbar, AHR-942 Empty-state, AHR-943 Field composer + single_select, AHR-944 Column controls, AHR-945 Contract template + soft delete. AHR-946 (this, planned local) is the last to ship before `/pp`.

Execution Order: Step 3 of 3 — all prerequisites Done ✓ (AHR-942's sidebar changes landed first; AHR-946 layers on top without conflict).

## Phase A: Top-of-sidebar block polish

- [x] Edit `PageEmployees_ViewsSidebar.tsx` — locate the "Search + create" block inside the `return (...)` at the "views exist" branch (after the `isLoading` and `employeeViews.length === 0` early returns)
- [x] Change the container style: replace `display: 'flex', flexDirection: 'column', gap: token.marginXS` with `display: 'flex', alignItems: 'center', gap: token.marginXS`. Keep `padding: token.paddingSM`. Add `borderBottom: \`1px solid ${token.colorBorderSecondary}\`` for the subtle layering line
- [x] Update the `<Input>`:
  - Drop `size="small"`
  - Add `variant="borderless"`
  - Add `style={{ flex: 1 }}` so it fills the available horizontal space
  - Keep `allowClear`, the `SearchOutlined` prefix, the value/onChange bindings
- [x] Replace the `<Button block type="dashed" size="small" icon={<PlusOutlined />} onClick={onCreateView}>New View</Button>` with:
  ```tsx
  <Tooltip title="Create new view">
      <Button type="text" icon={<PlusOutlined />} onClick={onCreateView} />
  </Tooltip>
  ```
- [x] Ensure `Tooltip` is imported (already imported in this file? verify)
- [x] Leave the `employeeViews.length === 0` and `isLoading` branches untouched — they use different UI (primary `<Button>` and `<Spin>` respectively)

## Phase B: Verification

- [x] `pnpm type-check` — clean
- [x] `pnpm build` — clean
- [x] Browser smoke: on a page with saved views, the sidebar top row shows a borderless search input flush with an icon-only `+` button; hovering the button shows the "Create new view" tooltip; clicking opens the existing `PageEmployees_ViewNameModal`
- [x] Browser smoke: typing in the search filters the list as before
- [x] Browser smoke: verify the empty-state branch (0 views) still looks correct — unchanged by this T2
- [x] Browser smoke: verify the `borderBottom` reads as a subtle hairline in both light and dark themes (ANTD tokens handle theme)

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Container style change: (pending)
- Input borderless + flex 1: (pending)
- Button swap to text+icon+tooltip: (pending)
- Tooltip import verification: (pending)

Phase B: (pending)
- type-check: (pending)
- build: (pending)
- Browser smoke (tooltip + click + modal): (pending)
- Browser smoke (search filter): (pending)
- Browser smoke (empty state unchanged): (pending)
- Browser smoke (border hairline): (pending)
