# Sort, filter, group consumed from existing state

Work Item: AHR-1191 ([Plane](https://plane.jimbui.dev/aiur/browse/AHR-1191/))
Tier 1: AHR-1187 [v0.0.1 | Employee Management] Grid view — experimental parallel view via Glide Data Grid (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/675ea381-0e7c-427d-9fa7-0c30d2a567e2

## Context (from spec)

Non-tech: Sort, filter, and group controls in the toolbar already work. The Grid view body respects them identically — filtered/sorted rows, collapsible group headers with depth-based indent and record count. Same inputs produce the same visible rows as the Table view.

Tech: `App_EmployeeDataTable` currently holds the evaluation logic: `evaluateFilter`, `compareFieldValues`, grouping via nested `buildLevel` recursion producing a `DisplayRow[]` flat array with `GroupHeaderRow` sentinels interleaved between employee rows. Group collapse stack prunes children below a collapsed header. The cleanest path: **extract the filter/sort/group engine into a shared util** so both Table and Grid consume the same result. This also de-risks a future Table removal.

Related: `App_EmployeeDataTable.tsx` lines ~186-409 (evaluateFilter, sortedRows, displayRows, visibleDisplayRows). Types in `@/types/employeeTable.types`.

Siblings: 4 total, 0 Done — AHR-1188 (Todo, prerequisite), AHR-1189 Grid render (Todo, prerequisite), AHR-1190 Column controls (Todo, parallel), AHR-1191 (this, Todo)
Execution Order: Step 3 of 3 (parallel with AHR-1190) — depends on AHR-1189 (Grid render). Do NOT start before AHR-1189 is locally complete.

## Design decisions

- **Extract shared engine:** move filter/sort/group logic into `frontend/vite/src/utils/Utils_EmployeeTable_Engine.ts` with named exports (`filterRows`, `sortRows`, `buildDisplayRows`, `pruneCollapsed`). Table and Grid both import. This is a refactor of existing working code — keep behavior byte-identical, verified by running existing usage unchanged.
- **Group header rows in Glide:** Glide does not natively support spanning group header rows. Use its `freezeColumns: 0` + custom `getCellContent` that returns a group-row payload when `rows[rowIndex]` is a GroupHeaderRow. Render via `GridCellKind.Custom` or a wide `Text` cell that visually spans by drawing over adjacent cells. Alternative: use Glide's `groupHeader` API (check lib docs) — if it supports depth + collapse natively, prefer that.
- **Collapse state:** keep `collapsedGroupIds: Set<string>` local to the Grid component (same as Table). Click the caret in the custom group-row renderer → update the set → re-derive visible rows.
- **Empty state:** if `visibleRows.length === 0` after filter/group, render `<Empty>` below/over the Grid with "No employees match your filters".

## Phase A: Extract shared engine

- [x] Create `src/utils/Utils_EmployeeTable_Engine.ts`
- [x] Move `isEmptyValue`, `compareFieldValues`, `evaluateOperator`, `evaluateFilter` → named exports
- [x] Move `GroupHeaderRow`, `DisplayRow`, `isGroupHeader` → named exports
- [x] Move `buildDisplayRows(rows, groupBy, fieldsByKey, choicesByField): DisplayRow[]` — pure function
- [x] Move `pruneCollapsed(displayRows, collapsedGroupIds): DisplayRow[]` — pure function
- [x] Update `App_EmployeeDataTable.tsx` to import from the new util; delete local copies
- [x] Verify no behavior change in the existing Table view (visual + interaction smoke test)

## Phase B: Wire engine into Grid

- [x] In `App_EmployeeDataGrid.tsx`: compute `baseRows` → `filteredRows` → `sortedRows` → `displayRows` → `visibleRows` using the engine utils (mirror the Table's sequence)
- [x] Drive Glide's `rows` count = `visibleRows.length`
- [x] In `getCellContent`, branch on `visibleRows[rowIndex]` — if group header, return a group-row cell; else standard cell render (T2-B path)

## Phase C: Group header rendering in canvas

- [x] Check Glide's native group/row-markers capabilities first — if a spanning header row is supported natively (e.g. `groupHeader` prop), use it
- [x] If not, use `GridCellKind.Custom` at col 0 with `drawCell` that paints across the row (width = full canvas width). Adjacent cells return `colSpan > 1` or render blank
- [x] Render: indent by `depth * 20px`, caret (right / down), field label + value, right-aligned record count
- [x] Clicking the group row toggles `collapsedGroupIds` — wire via `onCellClicked` on the group row

## Phase D: Sort direction indicator in header

- [x] Map `sortState[].direction` to Glide column headers — show an up/down caret next to the column title
- [x] Glide `GridColumn.overlayIcon` or a header-draw hook — pick whichever renders cleanest
- [x] Clicking a sorted column header is a no-op in this T2 (toolbar owns sort) — future enhancement

## Phase E: Empty state + smoke test

- [x] When `visibleRows.length === 0` after filter: render ANTD `<Empty description="No employees match your filters" />` over the Grid body
- [x] Smoke test: apply filter via toolbar → Grid filters identically to Table
- [x] Smoke test: group by department (or any multi_select) → group rows render, collapse works, counts correct
- [x] Smoke test: multi-level group → nested collapse cascades as expected
- [x] Side-by-side: switch between List and Grid with the same view active — visible row set should be identical

---

## Plane IDs (populated by /pp)

Phase A: AHR-1271
- Task 1: AHR-1276
- Task 2: AHR-1277
- Task 3: AHR-1278
- Task 4: AHR-1279
- Task 5: AHR-1280
- Task 6: AHR-1281
- Task 7: AHR-1282

Phase B: AHR-1272
- Task 1: AHR-1283
- Task 2: AHR-1284
- Task 3: AHR-1285

Phase C: AHR-1273
- Task 1: AHR-1286
- Task 2: AHR-1287
- Task 3: AHR-1288
- Task 4: AHR-1290

Phase D: AHR-1274
- Task 1: AHR-1292
- Task 2: AHR-1293
- Task 3: AHR-1294

Phase E: AHR-1275
- Task 1: AHR-1295
- Task 2: AHR-1296
- Task 3: AHR-1297
- Task 4: AHR-1298
- Task 5: AHR-1299
