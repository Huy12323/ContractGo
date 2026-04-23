# Employee detail modal + row expand + row numbering > Details tab: view + edit + save

Work Item: [AHR-1388](https://plane.jimbui.dev/aiur/browse/AHR-1388/)
Tier 1: [AHR-1364](https://plane.jimbui.dev/aiur/browse/AHR-1364/) [v0.0.1 | Employee Management] Employee detail modal + row expand + row numbering (In Progress)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: The Details tab fills the employee modal's body — all universal + dynamic fields displayed in a 2-column snake-fill layout. Click Edit → every field becomes an input (per its type); click Save → all dirty fields commit in one mutation; grid updates to reflect. Dirty tracking drives the three-way prompt delivered by AHR-1387.

Tech: New files — `useM_Employee_Update.ts` (patches `employees` row by id with optimistic update + employees-query invalidation), `AppEmployeeDetailModal_FieldRenderer.tsx` (pure view/edit component per field.type, wraps ANTD Input/InputNumber/DatePicker/Switch/Select), `AppEmployeeDetailModal_DetailsTab.tsx` (consumes Provider Context, renders snake-fill). Provider state in `App_EmployeeDetailModal.tsx` refactored from `{ editMode, isDirty }` to `{ editMode, patch }` — `patch: Record<string, unknown>` holds only changed fields; `isDirty = Object.keys(patch).length > 0` derived inline. Modal shell `handleSave` swaps from stub to real mutation call; tab body reads effective values as `patch[key] ?? employee[key]`. Modal gains `fields` + `choicesByField` props passed from `PageEmployees_ListView`.

Related: AHR-1387 (Done local, pending /pp) — delivers the modal shell, Tabs container, edit state machine, three-way prompt. This T2 fills the tab body.

Siblings: 2 total, 1 Done — AHR-1387 Modal shell + grid wiring (Done local, pending /pp), AHR-1388 Details tab: view + edit + save (this, In Progress)
Execution Order: Step 2 of 2 — Step 1 (AHR-1387) Done local ✓

## Phase A: Mutation hook + field renderer

- [x] Created `frontend/vite/src/hooks/useM_Employee_Update.ts` — `useMutation` with body `{ employeeId, patch: Record<string, unknown> }`; calls `supabase.from("employees").update(patch as never)`; ANTD `message.success`/`message.error`; invalidates `QueryKeys.employees.all()` on success. Skipped optimistic update — the realtime sync + manual invalidation already propagate the change to the grid within a tick, and an optimistic update on `Record<string, unknown>` would need full-row merge logic. Can add later if perceived latency is an issue.
- [x] Created `frontend/vite/src/components/employees/AppEmployeeDetailModal_FieldRenderer.tsx` — pure component rendering view vs edit per `field.type`. View: Typography.Text / Tag / Tag list; edit: Input / InputNumber / DatePicker (dayjs) / Switch / Select / Select mode="multiple". Uses `theme.useToken()` for all styles.
- [x] Empty-value handling: view mode shows "Null" placeholder (`colorTextTertiary`) for null/undefined/empty string/empty array. Edit mode uses sensible defaults (empty Input, `null` for InputNumber, `undefined` for Select, `false` for Switch).

## Phase B: Provider refactor + Details tab body

- [x] Refactored Provider in `App_EmployeeDetailModal.tsx`: `State` now `{ editMode, patch }`; removed `setDirty` helper and its entry in `ContextDefault`. Shell derives `const isDirty = Object.keys(patch).length > 0` inline.
- [x] `handleClose` / `onCancel` paths reset via `pModal.setState({ editMode: 'view', patch: {} })`.
- [x] Created `frontend/vite/src/components/employees/AppEmployeeDetailModal_DetailsTab.tsx` — consumes `useProvider_App_EmployeeDetailModal`; filters `isSystemFieldKey`; snake-fills into left/right via modulo-2 split; wraps in ANTD `Row`/`Col` with `gutter={token.marginLG}`.
- [x] Per-field rendering: `effectiveValue = field.key in patch ? patch[field.key] : (employee as Record<string, unknown>)[field.key]`. Label above field (Typography.Text secondary, fontSizeSM) + the renderer below. `onChange` writes to `patch` via `setState`.

## Phase C: Save mutation + modal integration

- [x] Replaced `handleSave` stub in shell with real mutation call: `await mUpdateEmployee.mutation.mutateAsync({ employeeId: employee.id, patch })`, reset state + close on success. Error path swallows at shell (mutation's `onError` already toasts), stays in edit mode with patch intact. Save button also shows `loading={mUpdateEmployee.mutation.isPending}`.
- [x] Added `fields` + `choicesByField` to modal `Props`; tab body renders only when `employee` is non-null; Tabs `children` swapped from the placeholder to `<AppEmployeeDetailModal_DetailsTab ... />`.
- [x] `PageEmployees_ListView.tsx`: passes `fields={listViewFields}` + `choicesByField={choicesByField}` to `<App_EmployeeDetailModal>`.

## Phase D: Verify

- [x] `pnpm tsc --noEmit` — only the three pre-existing errors remain (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`). No new errors.
- [ ] Browser verification — **not performed** (dev-server port conflict, same as AHR-1289 / AHR-1291 / AHR-1387).

**Manual verification checklist** (for PM review — combine with AHR-1387's):
1. Row-number click → modal opens with correct Full Name
2. "Details" tab body shows every non-system field in a 2-column layout. Left column holds indices 0, 2, 4, …; right holds 1, 3, 5, …
3. View mode renders correctly per field type: text / number / date (formatted) / boolean (Yes/No) / single_select (Tag with label) / multi_select (Tag list); empty values show "Null" placeholder
4. Click Edit → all fields become inputs of the right kind (Input / InputNumber / DatePicker / Switch / Select / multi-Select)
5. Change any field → Save button enables; dirty indicator is live
6. Click Save → modal closes, grid row reflects the new values, success toast appears
7. Simulate a server failure (e.g. temporarily break RLS or add a bogus constraint) → error toast appears, modal stays open in Edit with the user's patch intact
8. Change fields, click Cancel → three-way prompt; each path behaves per AHR-1387's checklist (Continue editing / Discard / Save changes)
9. Snake-fill drift check — if a user has one or two long multi-select values on the left column and mostly short text on the right, note whether the visual imbalance is bad enough to motivate the follow-up height-balancing T2

---

## Plane IDs (populated by /pp)

Phase A: AHR-1409

- Task 1: AHR-1410
- Task 2: AHR-1411
- Task 3: AHR-1412

Phase B: AHR-1413

- Task 1: AHR-1414
- Task 2: AHR-1415
- Task 3: AHR-1416
- Task 4: AHR-1417

Phase C: AHR-1418

- Task 1: AHR-1419
- Task 2: AHR-1420
- Task 3: AHR-1421
- Task 4: AHR-1422
- Task 5: AHR-1423

Phase D: AHR-1424

- Task 1: AHR-1425
- Task 2: AHR-1426
- Task 3: AHR-1427
