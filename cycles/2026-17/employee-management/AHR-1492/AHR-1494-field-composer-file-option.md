# Field composer — add 'file' option

Work Item: AHR-1494 (https://plane.jimbui.dev/aiur/browse/AHR-1494/)
Tier 1: AHR-1492 [v0.0.1 | Employee Management] File column type (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
Version Doc: https://outline.jimbui.dev/doc/5d80c0fb-cf52-4785-a819-f84c92251b56

## Context (from spec)

Non-tech: Show "File" as a selectable type when adding a column, with a paperclip icon on the resulting column's header. No choices panel for file type.
Tech: `EmployeeTable_FieldType` union extension + `FieldTypeIcon` switch case. The `const_EmployeeColumnsTypeOptions` entry was already added in AHR-1493 to satisfy TS.
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034)
Siblings: 2 total, 1 Done (local) — AHR-1493 Schema + edge fn (Done local, pending /pp), AHR-1495 Table cell (Todo)
Execution Order: Step 2 of 2 — AHR-1493 done ✓; parallel with AHR-1495

## Phase A: Extend type union

- [x] Edit `frontend/vite/src/types/employeeTable.types.ts` — add `"file"` to `EmployeeTable_FieldType` union

## Phase B: Icon mapping

- [x] Edit `frontend/vite/src/components/employees/App_EmployeeFieldTypeIcon.tsx`:
    - Import `PaperClipOutlined` from `@ant-design/icons`
    - Add `case 'file': return <PaperClipOutlined />` to the switch

## Phase C: Smoke

- [x] `pnpm tsc --noEmit` from `frontend/vite/` → 0 new errors
- [ ] In running dev app, open employee page → click add column → field composer modal → Type dropdown lists "File" → select → no choices panel appears → label = "Paperclip smoke" → create — USER TO VERIFY
- [ ] Verify column header in employee table shows 📎 paperclip icon (via Glide GridColumnIcon mapping from `FieldTypeIcon`) — USER TO VERIFY
- [ ] Delete the test column via header dropdown — USER TO VERIFY
