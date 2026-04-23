# Employee detail modal + row expand + row numbering > Modal shell + grid wiring

Work Item: [AHR-1387](https://plane.jimbui.dev/aiur/browse/AHR-1387/)
Tier 1: [AHR-1364](https://plane.jimbui.dev/aiur/browse/AHR-1364/) [v0.0.1 | Employee Management] Employee detail modal + row expand + row numbering (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Clicking the row-number gutter opens a modal for that employee. Modal shows the employee's Full Name in a prominent header, a tab bar with a single "Details" tab (empty body for now), and Edit / Save / Cancel buttons. This T2 ships the shell + plumbing; the field list + edit/save arrive in AHR-1388.

Tech: Grid gets `rowMarkers="clickable-number"` on `<DataEditor>`. `handleCellClicked` detects `col === -1` (Glide's marker-column convention) and invokes a new `onExpandEmployee(employeeId)` prop. `PageEmployees_ListView` owns `modalEmployeeId: string | null` state and renders `<App_EmployeeDetailModal>` when non-null. Modal internals: ANTD Modal (width 720, `maskClosable: false`), Typography.Title for the Full Name header, ANTD Tabs for the tab bar, footer buttons that swap by `editMode`. Dirty-state plumbing via `EmployeeDetailModalContext` — shell exposes `setDirty` + `editMode`; future tab bodies consume via `useContext`. Three-way prompt on Cancel / X / Esc / backdrop reuses the pattern from `App_FormBuilderModal.tsx:349-368` (`modal.confirm` with custom footer: Continue editing / Discard / Save changes).

Related: AHR-1291 (Done) — `isSystemFieldKey` helper already filters `__full_name` from the tab body population in AHR-1388. AHR-1289 (Done) — `__full_name` column exists on `employees`; the modal header reads it directly from the employee row.

Siblings: 2 total, 0 Done — AHR-1387 Modal shell + grid wiring (this, In Progress), AHR-1388 Details tab: view + edit + save (Not started)
Execution Order: Step 1 of 2 — no prerequisites; AHR-1388 depends on this

## Phase A: Grid + Page wiring

- [x] `App_EmployeeDataGrid.tsx`: added `rowMarkers="clickable-number"` to `<DataEditor>` (alongside the existing `freezeColumns={1}`)
- [x] `App_EmployeeDataGrid.tsx`: extended `handleCellClicked` — group-header rows branch first (col must be 0 for collapse); `col === -1` branch invokes `onExpandEmployee?.(record as EmployeeRow)`. Signature changed from `(employeeId: string)` to `(employee: EmployeeRow)` so the page gets the full row without re-querying.
- [x] `App_EmployeeDataGrid.tsx`: added `onExpandEmployee?: (employee: EmployeeRow) => void` to `Props` and destructured
- [x] `PageEmployees_ListView.tsx`: added `modalEmployee: EmployeeRow | null` state; pass `onExpandEmployee={(employee) => setModalEmployee(employee)}` to `<App_EmployeeDataGrid>`; render `<App_EmployeeDetailModal open={modalEmployee !== null} employee={modalEmployee} onClose={() => setModalEmployee(null)} />`

## Phase B: Modal shell component

- [x] Created `frontend/vite/src/components/employees/App_EmployeeDetailModal.tsx` with Props `open`, `employee: EmployeeRow | null`, `onClose`. `EmployeeRow = Tables_OrgEmployees_QueryData[number]`.
- [x] Created `Provider_App_EmployeeDetailModal` + `useProvider_App_EmployeeDetailModal()` hook exposing `{ state: { editMode, isDirty }, setState, setDirty }`. Pattern follows `bible-react-provider-context`: `class State` + `useReducer` + `setState(partial)`. Co-located in the same file.
- [x] Outer `App_EmployeeDetailModal` wraps `AppEmployeeDetailModal_Shell` in the Provider, keyed on `employee.id` when open (resets state per session; no need for a reset-on-open effect).
- [x] Modal layout: `<Modal width={720} maskClosable={false} title={null} destroyOnHidden footer={...}>`. Custom header in `children`, styled via theme tokens.
- [x] Header: `<Typography.Title level={3}>{employee?.__full_name ?? ''}</Typography.Title>` in a `paddingBottom: token.paddingLG` wrapper.
- [x] Tab bar: ANTD `<Tabs items={[{ key: 'details', label: 'Details', children: <div>To be populated (AHR-1388)</div> }]} />`

## Phase C: Edit state + dirty guard

- [x] State held in the Provider (`editMode: 'view' | 'edit'` default `'view'`; `isDirty: boolean` default `false`). State resets naturally because the Provider remounts when `open && employee.id` key changes.
- [x] Footer: `editMode === 'view'` → `[<Button type="primary" onClick={() => setState({ editMode: 'edit' })}>Edit</Button>]`; `editMode === 'edit'` → `[<Button onClick={handleClose}>Cancel</Button>, <Button type="primary" disabled={!isDirty} onClick={handleSave}>Save</Button>]`. `handleSave` is a stub that logs + closes; AHR-1388 replaces it.
- [x] `handleClose`: if `!isDirty` → reset editMode + `onClose()`. If `isDirty` → `modal.confirm` with title "Unsaved changes", `closable: false`, `maskClosable: false`, and a custom `footer` exposing Continue editing / Discard (CancelBtn) / Save changes (OkBtn). `onOk` → `handleSave()`; `onCancel` → reset state + `onClose()`; Continue editing → `instance.destroy()`. Structurally matches `App_FormBuilderModal.tsx:349-368`.
- [ ] Force-dirty debug verification — **not performed in this session** (no browser access). To manually verify, temporarily render `<Button onClick={() => pModal.setDirty(true)}>DEBUG</Button>` inside the shell, confirm the three-way prompt on Cancel with all three button paths, then remove before commit. Left as a manual verification step.

## Phase D: Verify

- [x] `pnpm tsc --noEmit` — only the three pre-existing errors remain (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`). No new errors.
- [ ] Browser: row-number click → modal opens with correct Full Name, Details placeholder body, Edit toggles footer — **not browser-verified** (dev-server port conflict).
- [ ] Browser: force-dirty → three-way prompt on Cancel / X / Escape / backdrop — **not browser-verified**.
- [ ] Browser: regression check — group-header collapse on col-0 click; dynamic column create/edit/hide/reorder unaffected — **not browser-verified**.

**Manual verification checklist** (for PM review):
1. Click a row number in the gutter — modal opens with the right employee's Full Name in the header
2. Tab bar shows a single "Details" tab; body reads "To be populated (AHR-1388)"
3. Click Edit — buttons swap to Cancel + Save; Save is disabled (no dirty fields yet)
4. Click Cancel with no changes — modal closes silently
5. Temporarily inject a "DEBUG: force dirty" button inside the shell, click it, then click Cancel — three-way prompt appears with Continue editing / Discard / Save changes; each path behaves correctly
6. Repeat step 5 with X / Escape / backdrop-click (backdrop is disabled via `maskClosable={false}` — confirm no close occurs)
7. Group-header row: click the group label → collapses/expands as before (col-0 path preserved)
8. Dynamic column: create, edit (pencil), hide (eye), delete via header menu — all still work

---

## Plane IDs (populated by /pp)

Phase A: AHR-1389

- Task 1: AHR-1390
- Task 2: AHR-1391
- Task 3: AHR-1392
- Task 4: AHR-1393

Phase B: AHR-1394

- Task 1: AHR-1395
- Task 2: AHR-1396
- Task 3: AHR-1397
- Task 4: AHR-1398
- Task 5: AHR-1399

Phase C: AHR-1400

- Task 1: AHR-1401
- Task 2: AHR-1402
- Task 3: AHR-1403

Phase D: AHR-1404

- Task 1: AHR-1405
- Task 2: AHR-1406
- Task 3: AHR-1407
- Task 4: AHR-1408
