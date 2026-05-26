# Multi-file detail modal

> Version: [Outline](https://outline.jimbui.dev/doc/47cbc890-7561-4483-beb5-4b3a0da7cc94) | Tier 1: [AHR-1989](https://plane.jimbui.dev/aiur/browse/AHR-1989/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- File field in employee detail modal renders a list of all files in the folder (filename + type indicator per file)
- User can upload additional files to an existing folder — each upload appends to the list
- User can remove individual files from a folder (R2 object + files row cleaned up)
- First upload to an empty file cell auto-creates a folder and stores folder ID in the cell
- Each file in the list is individually previewable (reuse existing preview modal)
- Delayed-upload pattern preserved — R2 writes happen at modal save time, not on file pick
- Pass scenario: user uploads 3 files to one cell, removes 1, previews the remaining 2 — all changes persisted correctly after save

## Scope boundaries

- No multi-select `<input multiple>` — user clicks "Add file" per file. Matches delayed-upload pattern
- Grid cell display updates are AHR-1992 — this T2 only changes the detail modal
- Folder modal (Google Drive-style card grid) is AHR-1992 — not this T2
- No drag-and-drop reordering of files. Files display in upload order (created_at)

## Decisions

- **Decision:** Compound patch value `FileFieldMultiPatch` with `{ __multi_file, folder_id, pending_uploads: File[], pending_deletes: string[] }`.
  **Rationale:** Multi-file requires tracking N uploads + N deletes per column key. Compound value keeps the `Record<string, unknown>` patch contract.
- **Decision:** Lazy conversion — `FileFieldEdit` converts string value to `FileFieldMultiPatch` on first user interaction.
  **Rationale:** Untouched file fields stay as strings. Orchestrator only sees compound type if user actually edited.
- **Decision:** `FileFieldView` shows all files as a vertical list, each clickable for preview.
  **Rationale:** View mode reflects full folder contents. Single-file folders still look like one row.

## Implementation

### Phase A — Multi-file patch types

Define the compound value type and type guard alongside the existing `FileDeleteMarker`.

- [x] Add `FileFieldMultiPatch` type: `{ __multi_file: true; folder_id: string | null; pending_uploads: File[]; pending_deletes: string[] }`
- [x] Add `isMultiFilePatch()` type guard function

### Phase B — FileFieldEdit rewrite

Replace the single-file 4-state renderer with a list-based multi-file editor.

- [x] Rewrite `FileFieldEdit`: render existing files from `folderFilesMap[folderId]` minus `pending_deletes`, plus `pending_uploads` as staged items. Each existing file row: paperclip + filename + Remove button. Each pending upload row: paperclip (green) + filename + "(ready to upload)" + Cancel button. Each pending delete: strikethrough + Undo button. "Add file" button at the bottom.
- [x] On Add: append to `pending_uploads` in the compound value, emit via `onChange`
- [x] On Remove (existing file): append file_id to `pending_deletes`, emit via `onChange`
- [x] On Cancel (pending upload): remove from `pending_uploads`, emit via `onChange`
- [x] On Undo (pending delete): remove file_id from `pending_deletes`, emit via `onChange`
- [x] On first interaction with a string value: convert to `FileFieldMultiPatch` with `folder_id` set to the current string, empty arrays

### Phase C — FileFieldView multi-file list

- [x] Rewrite `FileFieldView`: show all files from `folderFilesMap[folderId]` as vertical list. Each row: `<PaperClipOutlined /> filename` as `Typography.Link`, click calls `onFilePreview(file.id)`. Empty folder shows "Null"

### Phase D — Save orchestrator multi-file handling

Update `App_EmployeeDetailModal.tsx` save orchestrator.

- [x] Add `isMultiFilePatch` check before existing `File instanceof` and `isFileDeleteMarker` checks
- [x] Handle `FileFieldMultiPatch`: if `folder_id` is null → create folder via SDK insert. Upload each `pending_uploads` file with `folder_id` via `mFilesUpload`. Delete each `pending_deletes` file via `files_r2_delete` edge fn.
- [x] After processing: count remaining files in folder (existing minus deleted plus uploaded). If zero → delete folder, cell = `null`. Otherwise cell = `folder_id`.

### Phase E — Verification

- [x] tsc clean — no type errors
- [ ] Manual smoke: upload 3 files to empty cell → save → verify all 3 in view mode list. Remove 1 → save → verify 2 remain. Add 1 more → save → verify 3 total. Preview individual file from view mode. Upload to empty cell → verify folder auto-created.

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Employee file columns now support folders (AHR-1990). This T2 upgrades the detail modal from single-file to multi-file management — users can add, remove, and preview multiple files per field.
Tech: `AppEmployeeDetailModal_FieldRenderer.tsx` (FileFieldView + FileFieldEdit rewrite), `App_EmployeeDetailModal.tsx` (save orchestrator compound value handling), `useQ_Tables_OrgFiles` (folderFilesMap already available from AHR-1990), `useM_Files_Upload` (folder_id param already available from AHR-1990)
Related: [File Storage](https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — R2 edge functions unchanged, reused as-is
Siblings: 3 total, 0 Done (Plane) / 1 Done (local, pending /pp) — [AHR-1990 Folders table + data migration (Done local), AHR-1992 Multi-file grid cell display (Todo)]
Execution Order: Step 2 of 2 — prerequisite AHR-1990 done (local) ✓
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
