# [v0.0.1 | Employee Management] Contract composer template builder > Contract template preview

Work Item: [AHR-468](https://plane.jimbui.dev/aiur/browse/AHR-468/)
Tier 1: [AHR-464] [v0.0.1 | Employee Management] Contract composer template builder (In Progress)
Module: [Employee Management](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd)
Version Doc: [Employee Management](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802)

## Context (from spec)

Non-tech: Toggle inside the contract composer modal switches to preview mode where text renders as a formatted document and fieldInput nodes render as actual form controls (text input, number input, date picker, switch, multi-select dropdown). Simulates the employee's filling experience and matches the eventual PDF export appearance.
Tech: `src/components/employees/ext_TipTap_FieldInput.tsx` — modify FieldInputComponent to render ANTD form controls when `!editor.isEditable`. `src/components/employees/App_FormBuilderModal.tsx` — fetch employee_column_choices, inject into editor storage. Existing preview toggle (editor.setEditable, toolbar/sidebar hide) reused.
Related: [Database](https://outline.jimbui.dev/doc/ad9ac12e-6806-4e99-b5fc-eb5b8a81058b) — base schema. [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org context.
Siblings: 4 total, 2 Done — [AHR-467 Contract composer editor (Done, local pending /pp), AHR-468 Contract template preview (this), AHR-469 employee_contracts table (Done), AHR-470 Organization soft delete (Cancelled)]
Execution Order: Step 3 of 3 — AHR-469 done ✓, AHR-467 done (local) ✓

## Phase A: Preview form controls

- [x] Add `addStorage()` to FieldInput extension — define `choicesMap` slot for multi_select options data
- [x] Fetch choices + inject into editor storage — call `useQ_Tables_EmployeeColumnChoices` in App_FormBuilderModal, build map keyed by column ID, write to `editor.storage.fieldInput.choicesMap`
- [x] Modify FieldInputComponent — when `!editor.isEditable`: render ANTD form control by fieldType (text→Input, number→InputNumber, date→DatePicker, boolean→Switch, multi_select→Select with choices). When editable: keep current chip rendering
- [x] Document-like styling — inline-block controls with reasonable widths, clean borders, consistent line heights for PDF-like appearance

---

## Plane IDs (populated by /pp)

Phase A: AHR-489
- Task 1: AHR-490
- Task 2: AHR-491
- Task 3: AHR-492
- Task 4: AHR-493
