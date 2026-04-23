# Column reorder, resize, hide + Add field affordance

Work Item: AHR-1190 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1190/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context (from spec)

Non-tech: User can drag to reorder columns, drag right-edge to resize, hide a column from a header menu, and click a "+" affordance to open the field composer. All three persist to the saved view and survive reload.

Tech: `PageEmployees_ListView` already wires `onColumnResize` / `onColumnOrderChange` / `onHideField` / `onAddField` / `onEditField` props → calls `patchActiveView` which runs `useM_EmployeeView_Update` with optimistic cache update. Grid just has to wire Glide's native controls to those same callbacks. Saved-view schema (`field_order`, `field_widths`, `hidden_keys`) is unchanged.

Glide native APIs: `onColumnResize: (col, newSize) => void` fires on release. `onColumnMoved: (from, to) => void` for reorder (requires enabling drag in column config). Header menu not native — Glide provides `onHeaderMenuClick: (col, bounds) => void` that we wire to an ANTD `<Dropdown>` at the `bounds` rect.

Related: `App_EmployeeDataTable.tsx` has the reference wiring — resize handlers call `onColumnResize(f.key, data.size.width)`, reorder splices `fieldOrder` and calls `onColumnOrderChange(next)`, hover chevron opens `<Dropdown>` with Edit/Hide/Delete. The Grid should replicate the behavioral contract, not the DOM strategy.

Siblings: 4 total, 0 Done — AHR-1188 (Todo, prerequisite), AHR-1189 Grid render (Todo, prerequisite — need the body first), AHR-1190 (this, Todo), AHR-1191 Sort/filter/group (Todo, parallel)
Execution Order: Step 3 of 3 (parallel with AHR-1191) — depends on AHR-1189 (Grid render). Do NOT start before AHR-1189 is locally complete.

## Design decisions

- **Persistence contract:** always call the existing callbacks. The Grid does not own `field_order` / `field_widths` / `hidden_keys` — those live on the saved view. Callbacks fire on gesture release; optimistic update in `useM_EmployeeView_Update` handles the instant UI response.
- **Resize:** use Glide's native `onColumnResize` (final size on mouse-up). No `onResizeStart` custom work; Glide handles live preview via its internal canvas redraw.
- **Reorder:** enable via `GridColumn.grow` + the `onColumnMoved` callback. No custom ghost / drop indicator — Glide's canvas already paints the reorder animation natively. This is the single biggest UX win vs the ANTD implementation.
- **Hide:** header menu hook → ANTD `<Dropdown>` at returned bounds. Menu: Edit / Hide / (divider) / Delete. Universal keys disable Edit + Delete (same rule as Table: `UNIVERSAL_KEYS = {'first_name', 'last_name', 'email', 'birthday'}`).
- **Add field:** trailing "+" column. Glide supports a trailing-row callback — for trailing *column*, the cleanest path is an extra column at the end of the `columns` array with a custom drawn "+" icon, matched in `onHeaderClicked` to fire `onAddField()`. Confirm the pattern works via Glide docs in Phase A.

## Phase A: Column resize

- [x] Wire `DataEditor` prop `onColumnResize={(col, newSize) => onColumnResize?.(fields[col.sourceIndex].key, newSize)}`
- [x] Confirm resized width persists to the active view (network tab shows `field_widths` patch)
- [x] Reload page → column retains resized width
- [x] Verify min-width floor (100px) is enforced — if Glide allows narrower, clamp via `Math.max(100, newSize)` before the callback

## Phase B: Column reorder

- [x] Enable reorder via `DataEditor` prop `onColumnMoved={(from, to) => { ... }}`
- [x] Compute next `field_order`: splice source key from `fieldOrder`, insert at target index (account for shifted indices when source < target, same logic as existing Table impl)
- [x] Wire `onColumnOrderChange?.(nextOrder)`
- [x] Verify reorder animation renders in-canvas (Glide native) — no custom ghost needed
- [x] Reload → column order persists

## Phase C: Header menu (hide + edit + delete)

- [x] Wire `onHeaderMenuClick={(col, bounds) => setMenuState({ col, bounds })}`
- [x] Render an ANTD `<Dropdown>` at `bounds` with Edit / Hide / Delete items (replicate `App_EmployeeDataTable` menu structure)
- [x] Edit → `onEditField?.(field.key)`
- [x] Hide → `onHideField?.(field.key)` (List already patches `hidden_keys`)
- [x] Delete → `modal.confirm(...)` + `useM_EmployeeColumn_Delete` (same flow as Table)
- [x] Disable Edit + Delete for universal keys
- [x] Verify hidden column is re-addable via the toolbar's Hide Fields popover (existing toolbar already toggles `hidden_keys`)

## Phase D: Add field ("+") trailing column

- [x] Append an extra synthesized column at end of `columns`: `{ id: '__add_field__', title: '', width: 48 }`
- [x] Custom-draw the column header as a centered `+` icon
- [x] Wire `onHeaderClicked={(col) => { if (columns[col].id === '__add_field__') onAddField?.() }}`
- [x] Exclude the synthetic column from resize / reorder / hide logic — cross-check via the column id guard
- [x] Verify clicking "+" opens the existing `App_EmployeeFieldComposerModal`

## Phase E: Cursor affordances + polish

- [x] Resize cursor (`col-resize`) visible on right edge — Glide default, verify
- [x] Reorder cursor (`grab`) visible on header body — Glide default, verify
- [x] No visual lag on reorder — if Glide jitters, note in the Planning Decisions of the version doc for a follow-up

---

## Plane IDs (populated by /pp)

Phase A: AHR-1241
- Task 1: AHR-1246
- Task 2: AHR-1247
- Task 3: AHR-1248
- Task 4: AHR-1249

Phase B: AHR-1242
- Task 1: AHR-1250
- Task 2: AHR-1251
- Task 3: AHR-1252
- Task 4: AHR-1253
- Task 5: AHR-1254

Phase C: AHR-1243
- Task 1: AHR-1255
- Task 2: AHR-1256
- Task 3: AHR-1257
- Task 4: AHR-1258
- Task 5: AHR-1259
- Task 6: AHR-1260
- Task 7: AHR-1261

Phase D: AHR-1244
- Task 1: AHR-1262
- Task 2: AHR-1263
- Task 3: AHR-1264
- Task 4: AHR-1265
- Task 5: AHR-1266

Phase E: AHR-1245
- Task 1: AHR-1267
- Task 2: AHR-1269
- Task 3: AHR-1270
