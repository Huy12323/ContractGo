# Density pass — shrink text, buttons, view cards to compact Airtable-style spacing

Work Item: [AHR-988](https://plane.jimbui.dev/aiur/browse/AHR-988/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The employee-management page surface was visually oversized — too much whitespace, bulky toolbar buttons with outlines, oversized view cards in the sidebar, and roomy table rows. The Airtable-style "dense grid, compact chrome" look that the feedback memo requires had drifted. This T2 is a one-level-down density pass across the page header, inner toolbar, views sidebar, and data table so the table becomes the visual center and the chrome disappears into it. Toolbar buttons are now borderless (`type="text"`) and unbolded; the field-picker dropdowns in Hide Fields / Filters / Groups / Sort now mirror the data table's column-header field-type icon prefix for fast visual scanning.

Tech: Four files touched, all via ANTD theme tokens per the `feedback_antd_tokens` memory. `Page_Employees.tsx`: `HEADER_HEIGHT` constant 48→40, Onboarding primary button → `size="small"`. `PageEmployees_ListView.tsx`: inner toolbar height 48→40, sidebar-toggle + view-name shrink (`size="small"`, `token.fontSizeSM`), 4 tool buttons (Hide/Filters/Groups/Sort) switch to `type="text" size="small"` with a new `toolButtonBaseStyle { fontWeight: 400 }` that merges into the existing active style to override `Provider_ANTD`'s global `Button.fontWeight: 600`. The 3 field-picker Selects in ConditionRow / Group / Sort gain `optionRender` that emits `<FieldTypeIcon type>` + label at `token.fontSizeSM`; options carry `type` alongside `{value, label}` for the renderer. The Hide Fields Checkbox list wraps `f.label` in a `<span>` with the same icon prefix. 7 Selects (field + operator + value in filters, field + direction in group/sort) gain `popupClassName="field-select-popup"`; a scoped `<style>` block inside the component's JSX overrides `.ant-select-item` padding (`paddingXS`/`paddingSM`) + `line-height: 1.4` + `.ant-select-item-option-content` font-size to `fontSizeSM` — this is necessary because `Provider_ANTD` sets `Select.controlHeight: 40` which ANTD cascades to `optionHeight`. `PageEmployees_ViewsSidebar.tsx`: `rowBaseStyle` padding tightens to `paddingXXS/paddingXS`, view-name `fontSize` → `token.fontSizeSM`, Plus create button → `size="small"`. `App_EmployeeDataTable.tsx`: `FieldTypeIcon` is exported (was file-local) for ListView reuse; the inline `<style>` block gets new rules for `.ant-table-thead > tr > th` and `.ant-table-tbody > tr > td` — `padding: paddingXXS / paddingXS` + `font-size: fontSizeSM`; existing `border-width: 2px !important` drops to `1px !important`; group-header row `minHeight` 52→36, padding block-paddingXS / inline-paddingMD with `paddingXS + indent` left inset, label `fontSize` 14→`token.fontSizeSM`, secondary field label 11→10. Data-table `App_EmployeeDataTable.tsx` already had staged in-progress edits from a prior session — these density changes were layered on top without conflict.

Related: AHR-944 (Table column controls) — the prior staged edits on `App_EmployeeDataTable.tsx`; the density CSS here does not collide with column-controls edits (disjoint rules). AHR-946 (Views sidebar UI polish) — landed the borderless search + `+` icon button on the sidebar; this T2 further shrinks the sidebar rows. AHR-941 (Auto-save view config + toolbar overhaul) — established the toolbar shell this T2 re-skins. `feedback_airtable_toolbar` memory — captures the borderless compact direction applied here.

Siblings: 7 total (this T2 is the 7th, added mid-cycle), 5 Done (local, pending /pp) — AHR-941 Auto-save + toolbar, AHR-942 Empty-state, AHR-943 Field composer + single_select, AHR-944 Column controls, AHR-945 Contract template + soft delete, AHR-946 Views sidebar UI polish. AHR-988 is planned last since it layers on top of the shells the other 6 established.

Execution Order: Step 7 of 7 — all 6 prior T2s must be Done before the density pass runs, since this T2 touches their structural output (toolbar shell from AHR-941/943, sidebar shell from AHR-942/946, table chrome from AHR-944, group-header from the grouping feature).

## Phase A: Page header + toolbar density + tool-button borderless/unbold + field-picker optionRender + compact popup rows

- [x] Edit `Page_Employees.tsx` — `const HEADER_HEIGHT = 48` → `40`
- [x] Edit `Page_Employees.tsx` — Onboarding primary `<Button>` gains `size="small"`
- [x] Edit `PageEmployees_ListView.tsx` — inner toolbar wrapper div `height: 48, minHeight: 48` → `40/40`
- [x] Edit `PageEmployees_ListView.tsx` — sidebar-toggle `<Button type="text" icon={<MenuOutlined/>}>` gains `size="small"`
- [x] Edit `PageEmployees_ListView.tsx` — view-name `Typography.Text` style `fontSize: 14` → `fontSize: token.fontSizeSM`
- [x] Edit `PageEmployees_ListView.tsx` — add `toolButtonBaseStyle: { fontWeight: 400 }` constant; spread into `toolButtonActiveStyle`; pass `style={active ? toolButtonActiveStyle : toolButtonBaseStyle}` on all 4 tool buttons (Hide / Filters / Groups / Sort). Each button also becomes `type="text" size="small"`. This overrides the global `Button.fontWeight: 600` set in `Provider_ANTD`
- [x] Edit `PageEmployees_ListView.tsx` — import `FieldTypeIcon` from `@/components/employees/App_EmployeeDataTable`
- [x] Edit `PageEmployees_ListView.tsx` — ConditionRow field Select: options include `type`; add `optionRender` rendering `<FieldTypeIcon type>` prefix + label with `token.fontSizeSM`
- [x] Edit `PageEmployees_ListView.tsx` — Group Select: same treatment (options carry `type`, `optionRender` with icon)
- [x] Edit `PageEmployees_ListView.tsx` — Sort Select: same treatment
- [x] Edit `PageEmployees_ListView.tsx` — Hide Fields Checkbox list: wrap `{f.label}` in a `<span>` with `FieldTypeIcon` prefix + `token.fontSizeSM`
- [x] Edit `PageEmployees_ListView.tsx` — add scoped `<style>` block at top of JSX: `.field-select-popup .ant-select-item { min-height: 0; padding: ${token.paddingXS}px ${token.paddingSM}px; line-height: 1.4 }` + `.ant-select-item-option-content { font-size: ${token.fontSizeSM}px }`
- [x] Edit `PageEmployees_ListView.tsx` — add `popupClassName="field-select-popup"` to 7 Selects: ConditionRow field / operator / value (single_select + multi_select), Group field + direction, Sort field + direction
- [x] `pnpm tsc --noEmit` — only 3 pre-existing unrelated errors (auth forms + tanstack/history module augment); no new errors

## Phase B: Views sidebar density

- [x] Edit `PageEmployees_ViewsSidebar.tsx` — `rowBaseStyle` padding `${token.paddingXS}px ${token.paddingSM}px` → `${token.paddingXXS}px ${token.paddingXS}px` (row height drops from ~36px to ~26px)
- [x] Edit `PageEmployees_ViewsSidebar.tsx` — view-name `Typography.Text` style `fontSize: 13` → `fontSize: token.fontSizeSM`
- [x] Edit `PageEmployees_ViewsSidebar.tsx` — Plus create `<Button type="text" icon={<PlusOutlined/>}>` gains `size="small"`

## Phase C: Data table density + group-header tightening + FieldTypeIcon export

- [x] Edit `App_EmployeeDataTable.tsx` — `const FieldTypeIcon` → `export const FieldTypeIcon` (enables ListView import)
- [x] Edit `App_EmployeeDataTable.tsx` — scoped `<style>` block: change existing `border-width: 2px !important` rule to `1px !important` on `.ant-table-container`, `.ant-table-thead > tr > th`, `.ant-table-tbody > tr > td`
- [x] Edit `App_EmployeeDataTable.tsx` — scoped `<style>` block: add new rule `.ant-table-thead > tr > th, .ant-table-tbody > tr > td { padding: ${token.paddingXXS}px ${token.paddingXS}px !important; font-size: ${token.fontSizeSM}px }`
- [x] Edit `App_EmployeeDataTable.tsx` — group-header row div: `padding` to `${token.paddingXS}px ${token.paddingMD}px ${token.paddingXS}px ${token.paddingXS + indent}px`, `minHeight: 52` → `36`
- [x] Edit `App_EmployeeDataTable.tsx` — group-header strong label `Typography.Text` style `fontSize: 14` → `fontSize: token.fontSizeSM`
- [x] Edit `App_EmployeeDataTable.tsx` — group-header secondary field-label `Typography.Text` style `fontSize: 11` → `10`
- [x] `pnpm tsc --noEmit` — clean (only pre-existing errors)

## User feedback iterations

- [x] Initial popup padding was too small (`paddingXXS/paddingXS` = 4/8px) → bumped to `paddingXS/paddingSM` (8/12px) after user feedback "kinda too small, maybe bigger a bit"

---

## Plane IDs (populated by /pp)

Phase A: AHR-1137

- Task 1 (HEADER_HEIGHT 48→40): AHR-1138
- Task 2 (Onboarding button size=small): AHR-1139
- Task 3 (inner toolbar height 48→40): AHR-1140
- Task 4 (sidebar-toggle size=small): AHR-1141
- Task 5 (view-name fontSizeSM): AHR-1142
- Task 6 (tool buttons type=text size=small fontWeight 400): AHR-1143
- Task 7 (FieldTypeIcon import): AHR-1144
- Task 8 (ConditionRow field Select optionRender): AHR-1145
- Task 9 (Group Select optionRender): AHR-1146
- Task 10 (Sort Select optionRender): AHR-1147
- Task 11 (Hide Fields icon prefix): AHR-1148
- Task 12 (scoped popup style block): AHR-1149
- Task 13 (popupClassName on 7 Selects): AHR-1150
- Task 14 (typecheck): AHR-1151

Phase B: AHR-1152

- Task 1 (rowBaseStyle padding): AHR-1153
- Task 2 (view-name fontSizeSM): AHR-1154
- Task 3 (Plus button size=small): AHR-1155

Phase C: AHR-1156

- Task 1 (FieldTypeIcon export): AHR-1157
- Task 2 (border-width 2→1): AHR-1158
- Task 3 (cell padding + fontSize via scoped CSS): AHR-1159
- Task 4 (group-header row minHeight + padding): AHR-1160
- Task 5 (group-header strong label fontSizeSM): AHR-1161
- Task 6 (group-header secondary label 11→10): AHR-1162
- Task 7 (typecheck): AHR-1163
