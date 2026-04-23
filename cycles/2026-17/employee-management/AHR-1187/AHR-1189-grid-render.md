# Grid render with virtualization

Work Item: AHR-1189 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1189/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context (from spec)

Non-tech: The Grid view body actually renders employees using Glide Data Grid. Visual and data parity with the current ANTD table: universal + dynamic columns in the saved-view order, field-type icons in headers, per-type cell renderers (text/number/date/boolean/single-select tag/multi-select tags), "Null" for empty cells, virtualized 1000+ rows.

Tech: Glide's main component is `DataEditor` from `@glideapps/glide-data-grid`. Data model: provide `columns: GridColumn[]` + `getCellContent: (cell: Item) => GridCell`. `Item = [col, row]`. Cell kinds for our types: `GridCellKind.Text` / `GridCellKind.Number` / `GridCellKind.Boolean` / `GridCellKind.Bubble` (for multi-select) / `GridCellKind.Custom` (if we need tag rendering). Field-type icons via `GridColumn.icon` (Glide has a built-in icon set) or custom header renderer. Data source: `useQ_Tables_OrgEmployees` (full-row `select('*')` with `col_XXXX` dynamic values), `useQ_Tables_EmployeeColumns` (column metadata), `useQ_Tables_EmployeeColumnChoices` (select labels).

Related: `App_EmployeeDataTable.tsx` has the reference implementation — `FieldTypeIcon`, `formatDate`, `isEmptyValue`, cell renderers, `UNIVERSAL_FIELDS`, `COLUMN_WIDTH=180`, `COLUMN_MIN_WIDTH=100`. Reuse `EmployeeDataTable_UniversalFields`, `FieldTypeIcon`, and exported types.

Siblings: 4 total, 0 Done — AHR-1188 View type wiring (Todo, prerequisite), AHR-1189 (this, Todo), AHR-1190 Column controls (Todo), AHR-1191 Sort/filter/group (Todo)
Execution Order: Step 2 of 3 — depends on AHR-1188 (view type wiring + stub component)

## Design decisions

- **Data shape:** keep the same `EmployeeRow` / dynamic col resolution as the Table. No data transforms — Glide reads `row[field.key]`.
- **Column icons:** Glide ships icons via `GridColumnIcon`. Map our 6 field types to Glide's nearest equivalent (or register custom icons). If Glide's icons look off, use a header-cell custom renderer that mounts our existing `FieldTypeIcon` React component via Glide's `provideEditor` + `drawCell` hook.
- **Null rendering:** for empty cells (non-boolean), render "Null" in muted color. Use `GridCellKind.Text` with `data: ""` + `displayData: "Null"` + `themeOverride.textDark: tertiary`. Booleans: always render checkbox (false is a real value).
- **Single-select cell:** render as `GridCellKind.Bubble` with `[labelFromChoices]` + theme-tinted bg matching `token.colorPrimary`.
- **Multi-select cell:** `GridCellKind.Bubble` with the array of labels.
- **Row count:** `rows = qEmployees.employees.length`. Glide virtualizes internally — no ANTD `virtual` flag needed.
- **Width source:** columns `width: fieldWidths[f.key] ?? 180`, floor via CSS on the outer container if needed.

## Phase A: Skeleton + column definitions

- [x] In `App_EmployeeDataGrid.tsx`, compute `fields` from `universal + dynamic`, ordered by `fieldOrder`, filtered by `hiddenKeys` — mirror the `fields` useMemo in `App_EmployeeDataTable`
- [x] Build `columns: GridColumn[]` from fields: `{ title: f.label, id: f.key, width: fieldWidths[f.key] ?? 180, icon: mapFieldTypeToGlideIcon(f.type) }`
- [x] Render `<DataEditor columns={columns} rows={rows} getCellContent={getCellContent} />` inside a `flex: 1` wrapper
- [x] Confirm empty state (no rows) renders — use ANTD `<Empty>` below the Data Editor or as a sibling when rows === 0

## Phase B: Cell renderer per field type

- [x] Implement `getCellContent` — read `rows[rowIndex]`, resolve `field = fields[colIndex]`, extract value
- [x] Text / number: `GridCellKind.Text` / `Number`, `displayData`, `allowOverlay: false` (no editing in T1)
- [x] Date: format via `formatDate` helper, return `Text` cell with `data: ISO, displayData: localized`
- [x] Boolean: `GridCellKind.Boolean`, `data: value === true`, `readonly: true`
- [x] Single-select: look up `choicesByField[f.key][value]`, render as `GridCellKind.Bubble` with `[label]`
- [x] Multi-select: map `value[]` → labels via `choicesByField`, `GridCellKind.Bubble` with array
- [x] Empty cell (non-boolean): return `Text` cell with `displayData: "Null"` + muted theme override
- [x] Respect tertiary-text color for Null (token.colorTextTertiary)

## Phase C: Field-type header icons

- [x] Attempt Glide's built-in icon mapping first (`GridColumnIcon.HeaderString` / `Number` / `Date` / `Boolean` / `Array` etc.)
- [x] If visual match is poor, use `headerIcons` prop on DataEditor to register custom drawers that render our `FieldTypeIcon` equivalents
- [x] Sanity check: icons look like the Table's FieldTypeIcon at comparable density

## Phase D: Virtualization + 1000-row perf

- [x] Smoke test with ~1000 synthesized rows (temporary seed or duplicated real rows) — confirm smooth scroll with no frame drops via Chrome perf profiler
- [x] Confirm column widths read from `fieldWidths` prop render correctly
- [x] Confirm hidden columns (`hiddenKeys`) are excluded from `columns` array

## Phase E: Visual parity pass

- [x] Row height: match ANTD table's compact density (~28-30px). Glide `rowHeight` prop
- [x] Font: `token.fontSizeSM` via DataEditor `theme.baseFontStyle` or equivalent
- [x] Borders: 1px cool-tinted, match `token.colorBorder` via theme prop
- [x] Header bg: match `Table.headerBg: #FFFFFF` in Provider_ANTD — map to Glide theme `bgHeader`

---

## Plane IDs (populated by /pp)

Phase A: AHR-1214
- Task 1: AHR-1219
- Task 2: AHR-1220
- Task 3: AHR-1221
- Task 4: AHR-1222

Phase B: AHR-1215
- Task 1: AHR-1223
- Task 2: AHR-1224
- Task 3: AHR-1225
- Task 4: AHR-1226
- Task 5: AHR-1227
- Task 6: AHR-1228
- Task 7: AHR-1229
- Task 8: AHR-1230

Phase C: AHR-1216
- Task 1: AHR-1231
- Task 2: AHR-1232
- Task 3: AHR-1233

Phase D: AHR-1217
- Task 1: AHR-1234
- Task 2: AHR-1235
- Task 3: AHR-1236

Phase E: AHR-1218
- Task 1: AHR-1237
- Task 2: AHR-1238
- Task 3: AHR-1239
- Task 4: AHR-1240
