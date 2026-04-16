# Card icon system — level + count icons

Work Item: AHR-843 (https://plane.jimbui.dev/aiur/browse/AHR-843/)
Tier 1: AHR-841 [v0.0.1 | Employee Management] Org chart view polish — canvas freedom + card refinements (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Give each card a distinct visual identity beyond color by adding a large left-side level icon inside the colored header bar — Bank for Organization, Shop for Entity, Apartment for Department/Sub-department. Also fix the card bodies so count rows show the icon of the counted thing: the org body gains a missing icon next to its entity count; the entity body swaps its human (Team) icon for the department (Apartment) icon to match what's actually being counted.

Tech: Single-file edit, `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx`. Imports block: drop `TeamOutlined`, add `BankOutlined, ShopOutlined, ApartmentOutlined`. Inside `renderNode`, add a local `const LevelIcon = ...` ternary mapping `node.type` → icon component. Restructure the colored header `<div>` (lines 258-261) to flex row: left-side icon (`fontSize: 28`, full white, `flexShrink: 0`) + right-side text stack wrapped in `<div style={{ flex: 1, minWidth: 0 }}>` for ellipsis. Body count icons — add `<ShopOutlined />` to the org card body (currently icon-less) and swap `<TeamOutlined />` → `<ApartmentOutlined />` on the entity card body.

Related: AHR-844 (Department card body simplification) modified the dept body (lines ~277-297). AHR-843 modifies the colored header (257-261) + org/entity body (264-275) — disjoint surfaces, no conflict. AHR-842 (Truly-infinite transform pan) modified handlers/wrapper styling, no overlap with card markup.

Siblings: 4 total, 0 Done — AHR-842 Truly-infinite transform pan (In Progress, code-complete locally — 11/12 [x], manual smoke pending), AHR-844 Department card body simplification (In Progress, code-complete locally — 5/6 [x], manual smoke pending), AHR-853 Canvas background (Not started), AHR-843 (this — about to go In Progress).

Execution Order: Step 2 of 2 — AHR-844 (Step 1 dependency) effectively complete (code landed, only manual smoke unchecked). Sibling surfaces are disjoint so there's no real merge conflict to guard against.

## Phase A: Imports + level icon helper

- [x] Update the `@ant-design/icons` import block at the top of `Page_Employees.tsx` (around lines 3-15) — remove `TeamOutlined`, add `BankOutlined, ShopOutlined, ApartmentOutlined`. Keep the other icons (`ZoomInOutlined, ZoomOutOutlined, ExpandOutlined, PlusOutlined, DownOutlined, FileTextOutlined, SolutionOutlined, ApartmentOutlined [already adding], UnorderedListOutlined, SettingOutlined`). `TeamOutlined` removal is safe — verified only 2 occurrences today (import + entity body count at line 273, which this T2 is replacing)
- [x] Inside `renderNode`, after the existing `const typeLabel = ...` line (around line 240) and before `return (`, add:
      `const LevelIcon = node.type === 'org' ? BankOutlined : node.type === 'entity' ? ShopOutlined : ApartmentOutlined`
      Type inference should resolve correctly; no explicit type needed

## Phase B: Card header gets a left icon column

- [x] Restructure the colored header `<div>` (currently `Page_Employees.tsx:258`) style — change
      `{ background: colors.border, padding: `8px ${token.paddingMD}px` }` to
      `{ background: colors.border, padding: `8px ${token.paddingMD}px`, display: 'flex', alignItems: 'center', gap: 10 }`
- [x] Prepend the level icon inside the header `<div>`, before the two Typography.Text elements:
      `<LevelIcon style={{ fontSize: 28, color: '#fff', flexShrink: 0 }} />`
- [x] Wrap the two existing `Typography.Text` elements (name + type-label) in a
      `<div style={{ flex: 1, minWidth: 0 }}>` so ellipsis truncation on long names continues to work inside the flex container. The `minWidth: 0` is the standard flex-ellipsis fix — without it, long names would break out of the card width instead of truncating

## Phase C: Body count icons

- [x] Org card body (around lines 264-268) — change the Typography.Text inner content from
      `{node.children.length} {node.children.length === 1 ? 'entity' : 'entities'}` to
      `<ShopOutlined style={{ marginRight: 4 }} />{node.children.length} {node.children.length === 1 ? 'entity' : 'entities'}`
      (matches the icon pattern already used on the entity body)
- [x] Entity card body (around lines 271-275) — replace `<TeamOutlined style={{ marginRight: 4 }} />` with
      `<ApartmentOutlined style={{ marginRight: 4 }} />`. Rest of the line (children count + pluralization) stays
- [x] Run `pnpm tsc --noEmit` from `frontend/vite/` — expect no new errors (the one pre-existing unused-var in `_protected/route.tsx` is unrelated)
- [ ] Manual browser smoke on `/employees` chart mode: each card level shows the distinct icon inside the colored header (Bank / Shop / Apartment); icon sized to span both name + type-label rows; long names still truncate with ellipsis; org card body count has a shop icon; entity card body count has an apartment icon (not the old team icon); no other regressions to the dept card body (which AHR-844 already simplified), the canvas pan (AHR-842), or the expand/add buttons

---

## Plane IDs (populated by /pp)

Phase A: AHR-969 — Imports + level icon helper

- Task 1: AHR-970
- Task 2: AHR-971

Phase B: AHR-972 — Card header gets a left icon column

- Task 1: AHR-973
- Task 2: AHR-974
- Task 3: AHR-975

Phase C: AHR-976 — Body count icons

- Task 1: AHR-977
- Task 2: AHR-978
- Task 3: AHR-979
- Task 4: AHR-980
