# Table column controls — fixed widths, drag-reorder, + header

Work Item: [AHR-944](https://plane.jimbui.dev/aiur/browse/AHR-944/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Add per-column width persistence (resizable via drag handle, 100-600px bounds), drag-reorder of columns, a `+` column at the end for adding fields, and a hover chevron on each column header with an Edit / Hide / Delete menu. Universal columns (first_name, last_name, email, birthday) keep the chevron but have Edit and Delete disabled; "Hide column" works for all.

Tech: Install `react-resizable` for column resize — integrate via ANTD's `components.header.cell` pattern with a custom `ResizableHeaderCell` wrapping `<Resizable>`. Native HTML5 drag for column reorder (matches existing sidebar + toolbar patterns). Mutations go through `useM_EmployeeView_Update` partial-patch (already built in AHR-941). Composer entry points wired from the `+` column header and chevron context menu to `App_EmployeeFieldComposerModal` (already built in AHR-943). Delete reuses existing `useM_EmployeeColumn_Delete.ts`. Tables: `employee_views` (field_widths, field_order), `employee_columns` (via delete hook). Files: `App_EmployeeDataTable.tsx` (major edits — resize, drag-reorder, + col, chevron menu), `PageEmployees_ListView.tsx` (composer modal state + callback props to table), `package.json` (add deps).

Related: Composer (`App_EmployeeFieldComposerModal`) from sibling AHR-943 — this T2 wires its entry points. Delete hook `useM_EmployeeColumn_Delete` already exists.

Siblings: 6 total, 0 Done — AHR-941 Auto-save + toolbar (Done local, pending /pp), AHR-942 Empty-state (Planned local / in progress this round), AHR-943 Field composer + single_select (Done local, pending /pp), AHR-944 (this, planned local), AHR-945 Contract template + soft delete (Done local, pending /pp), AHR-946 Sidebar polish (Not started).

Execution Order: Step 2 of 3 — prerequisites all effectively Done ✓ (AHR-941 mutation hook, AHR-943 composer). Parallel with AHR-942.

## Phase A: Install `react-resizable`

- [x] Run `pnpm --filter @aiur-hr/web add react-resizable` + `pnpm --filter @aiur-hr/web add -D @types/react-resizable`
- [x] Verify install: `grep "react-resizable" frontend/vite/package.json`
- [x] Import the default CSS once (either in `App_EmployeeDataTable.tsx` at the top: `import 'react-resizable/css/styles.css'`, or in the app entrypoint). Choose whichever keeps the dep co-located with its consumer

## Phase B: Column resize

- [x] In `App_EmployeeDataTable.tsx`, create a `ResizableHeaderCell` component using `<Resizable>` from `react-resizable`:
  - Wraps the native `<th>` passed via ANTD's `components.header.cell` override
  - `width: column.width` (forwarded from ANTD's `onHeaderCell` payload)
  - `minConstraints: [100, 0]`, `maxConstraints: [600, 0]` (bounds per user)
  - `handle: <span className="column-resize-handle" onClick={(e) => e.stopPropagation()} />` — small right-edge grabber
  - `onResize` is a no-op during drag (only on stop commit)
  - `onResizeStop={(e, { size }) => onColumnResize(column.key, size.width)}`
- [x] Add a `fieldWidths: Record<string, number>` prop to `App_EmployeeDataTable` (default `{}`)
- [x] When building `columns` array, compute each column's `width` as `fieldWidths[field.key] ?? 180` (fall back to current `COLUMN_WIDTH` constant)
- [x] Pass each column an `onHeaderCell(column)` that returns `{ width: column.width, onResize, onResizeStop }` — ANTD forwards these as props to the custom header cell
- [x] Register `components.header.cell: ResizableHeaderCell` on the `<Table>` component
- [x] Add an `onColumnResize?: (columnKey: string, newWidth: number) => void` prop — table invokes this on every resize stop, ListView turns it into a mutation
- [x] Add a small CSS block (injected via the existing `<style>` block at the top of the render — see the `.emp-data-table` class pattern) for the resize handle: thin right-edge grabber, cursor `col-resize`, visible on column hover

## Phase C: Column drag-reorder

- [x] Add a draggable wrapper inside the column header render (NOT on the entire `<th>`, so clicking the label / chevron still works). Approach: render each column's header content with `<div draggable onDragStart onDragOver onDrop onDragEnd>`
- [x] Implement the drag state: `dragColumnKey` ref + `dragOverKey` state tracking `{ key, position: 'before' | 'after' }` (same pattern as `PageEmployees_ListView.handleSortDragStart/Over/End/Drop` — port those handlers)
- [x] Visual drop indicator: absolutely-positioned 2px colored bar on the left or right edge of the drop-target column during dragover (mirror the `PageEmployees_ListView` sort-drag visuals)
- [x] On drop, compute the next field order: take current `fieldOrder` (or fall back to `listViewFields.map(f => f.key)` if empty), splice the moved key into the new position, call `onColumnOrderChange?.(next)`
- [x] The `+` column is NOT draggable — exclude it from drag handlers and from the drop-target set
- [x] Universal columns ARE draggable (can be mixed freely with dynamic cols per Q9)
- [x] Add `onColumnOrderChange?: (order: string[]) => void` prop — table invokes this on drop commit

## Phase D: `+` column at end

- [x] When building the `columns` array in `App_EmployeeDataTable`, append a virtual column after the last visible field:
  - `key: '__add_field__'`
  - `width: 48`
  - `title: <Tooltip title="Add field"><PlusOutlined /></Tooltip>`
  - `render: () => null` — body cells have no content
  - `onHeaderCell: () => ({ onClick: () => props.onAddField?.(), style: { cursor: 'pointer', textAlign: 'center' } })`
  - NOT included in `hiddenKeys`, `fieldOrder`, `fieldWidths` resolution — it's virtual
- [x] Add `onAddField?: () => void` prop — table calls this on `+` column header click; ListView opens the composer in CREATE mode
- [x] The `+` column should remain visible even when all other columns are hidden (always the last column)
- [x] The `+` column is not resizable or draggable (header cell skips those handlers via a key check: `if (column.key === '__add_field__') return plain_th`)

## Phase E: Hover chevron + context menu

- [x] Restructure each column's header render (title function):
  - Layout: `<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>`
    - Left: type icon (existing `FieldTypeIcon`)
    - Middle: label (flex: 1, ellipsis)
    - Right: hover-only chevron `<DownOutlined />` inside an ANTD `<Dropdown>` — opacity 0 default, opacity 1 on header cell hover (via CSS `:hover` on the `<th>`)
  - CSS for hover opacity: add to the injected `<style>` block `.emp-data-table .ant-table-thead > tr > th:hover .column-chevron { opacity: 1 }`
- [x] Dropdown menu items (three in order, with divider before Delete):
  - **Edit field** — `key: 'edit'`, `icon: <EditOutlined />`, `disabled: isUniversal`
  - **Hide column** — `key: 'hide'`, `icon: <EyeInvisibleOutlined />`, always enabled
  - `{ type: 'divider' }`
  - **Delete field** — `key: 'delete'`, `icon: <DeleteOutlined />`, `danger: true`, `disabled: isUniversal`
- [x] Universal detection: `const isUniversal = EmployeeDataTable_UniversalFields.some(u => u.key === field.key)`
- [x] Menu onClick dispatch:
  - `edit` → `props.onEditField?.(field.key)` (ListView opens composer in EDIT mode with columnId)
  - `hide` → `props.onHideField?.(field.key)` (ListView patches `hidden_keys`)
  - `delete` → local handler: `App.useApp().modal.confirm({ title: 'Delete field?', content: 'This permanently removes the column and all its data.', okText: 'Delete', okType: 'danger', onOk: async () => await mDeleteColumn.mutation.mutateAsync() })` — uses the existing `useM_EmployeeColumn_Delete` hook directly from the table
- [x] `mDeleteColumn` needs `columnId` — instantiate per-column via `useM_EmployeeColumn_Delete({ columnId: field.key })` inline where the delete handler lives, OR refactor the hook to take `columnId` via `mutate({ columnId })`. Recommend the latter (matches the `useM_ContractTemplate_Archive` pattern from AHR-945) if the refactor is small; otherwise keep the per-column instantiation

## Phase F: Wire from ListView

- [x] In `PageEmployees_ListView.tsx`, add state: `[composerOpen, setComposerOpen] = useState(false)`, `[composerColumnId, setComposerColumnId] = useState<string | null>(null)`
- [x] Import `App_EmployeeFieldComposerModal` and render it at the bottom of the return, sibling to the existing `PageEmployees_ViewNameModal`:
  ```tsx
  <App_EmployeeFieldComposerModal
    open={composerOpen}
    onClose={() => { setComposerOpen(false); setComposerColumnId(null) }}
    organizationId={organizationId}
    columnId={composerColumnId}
  />
  ```
- [x] Add callbacks passed to `<App_EmployeeDataTable>`:
  - `onAddField={() => { setComposerColumnId(null); setComposerOpen(true) }}`
  - `onEditField={(colKey) => { setComposerColumnId(colKey); setComposerOpen(true) }}`
  - `onHideField={(colKey) => patchActiveView({ hidden_keys: [...hiddenKeys, colKey] })}`
  - `onColumnResize={(colKey, width) => patchActiveView({ field_widths: { ...fieldWidths, [colKey]: width } })}`
  - `onColumnOrderChange={(next) => patchActiveView({ field_order: next })}`
- [x] Pass `fieldWidths` (new in ListView — read from `activeView.field_widths`) to the table. Add the memo: `const fieldWidths = useMemo(() => (activeView?.field_widths as Record<string, number> | null) ?? {}, [activeView])`
- [x] All callbacks early-return if `!activeView` (disable table interactivity when no view is selected — safe since AHR-942 auto-selects the first view)

## Phase G: Verification

- [x] Run `pnpm type-check` — clean
- [x] Run `pnpm build` — clean
- [x] Browser smoke: resize a column by dragging its right edge — width persists after page refresh
- [x] Browser smoke: drag a column header to reorder — new order persists
- [x] Browser smoke: click `+` at the end of the header row — composer opens in CREATE mode; submit creates the column and it appears at the end of the row
- [x] Browser smoke: hover a column header → chevron appears; click it → Edit / Hide / Delete menu shows; Edit opens composer pre-filled; Hide adds to hidden_keys and column disappears; Delete shows confirm then removes the column
- [x] Browser smoke: universal column chevron menu → Edit and Delete are visually disabled; Hide works
- [x] Browser smoke: verify the `+` column stays at the end even after hiding or reordering other columns
- [x] Browser smoke: verify resize bounds — 100px min, 600px max

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Install react-resizable: (pending)
- CSS import: (pending)

Phase B: (pending)
- ResizableHeaderCell: (pending)
- fieldWidths prop + column width lookup: (pending)
- onResizeStop wiring: (pending)
- CSS for resize handle: (pending)

Phase C: (pending)
- Drag handlers on header content: (pending)
- Drop indicator visuals: (pending)
- onColumnOrderChange dispatch: (pending)

Phase D: (pending)
- Virtual `+` column: (pending)
- onAddField wiring: (pending)
- + column bypass for resize/drag: (pending)

Phase E: (pending)
- Header restructure with chevron: (pending)
- Hover opacity CSS: (pending)
- Dropdown menu items + disabled states: (pending)
- Delete confirm + hook wiring: (pending)

Phase F: (pending)
- Composer state in ListView: (pending)
- Composer modal mount: (pending)
- All callback props wired: (pending)
- fieldWidths memo: (pending)

Phase G: (pending)
- type-check: (pending)
- build: (pending)
- Resize smoke: (pending)
- Reorder smoke: (pending)
- Add field smoke: (pending)
- Chevron menu smoke (all actions): (pending)
- Universal disabled smoke: (pending)
- `+` column position smoke: (pending)
- Resize bounds smoke: (pending)
