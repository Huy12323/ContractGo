# Multi-file grid cell display

> Version: [Outline](https://outline.jimbui.dev/doc/47cbc890-7561-4483-beb5-4b3a0da7cc94) | Tier 1: [AHR-1989](https://plane.jimbui.dev/aiur/browse/AHR-1989/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- Grid cell for file columns shows appropriate representation for 0, 1, or N files
- Single file: show filename + thumbnail (backwards compatible with current display)
- Multiple files: show file count or compact stacked representation
- Empty cell: null placeholder (same as current)
- Cell click for 1 file opens preview modal directly; 2+ files opens a Google Drive-style folder modal
- Folder modal shows files as cards (thumbnail/icon + filename + size), clicking a card opens the preview modal
- Pass scenario: a cell with 3 files shows a count indicator in the grid; clicking opens the folder modal with 3 cards; clicking a card opens the preview

## Scope boundaries

- Folder modal is read-only — no add/remove/upload. Multi-file management is AHR-1991 (detail modal)
- No drag-and-drop or reordering in folder modal — files displayed in upload order
- No Office doc preview — same MIME-based preview as existing (image/PDF/fallback)

## Decisions

- **Decision:** Multi-file cells show first file thumbnail + "N files" in Drilldown pill.
  **Rationale:** Extends the existing Drilldown format naturally. Shows both content hint (thumbnail) and count.
- **Decision:** New `AppEmployee_FolderModal` — Google Drive card grid. Read-only browsing + preview.
  **Rationale:** User-requested Drive-style card view. Focused browsing without full detail modal overhead.
- **Decision:** Cell click routing: 1 file → preview; 2+ files → folder modal.
  **Rationale:** Single file is faster with direct preview. Multi-file needs a browsing step.

## Implementation

### Phase A — Multi-file grid cell rendering

Update the grid `case 'file'` to show file count for multi-file folders.

- [x] Update `case 'file'` in `getCellContent`: when `folderFilesMap[folderId]` has 2+ files, render Drilldown with `[{ text: "N files", img: firstFileThumbnailOrIcon }]` instead of the single filename
- [x] Single file (1 item in folder): keep current rendering (filename + thumbnail)

### Phase B — Folder modal component

New `AppEmployee_FolderModal` — Google Drive-style card grid for browsing folder contents.

- [x] Create `AppEmployee_FolderModal.tsx`: props `open`, `onClose`, `files: OrgFileRecord[]`, `organizationId`, `employeeId`, `columnId` (for signed URL context). Modal with title, card grid body
- [x] Card component: thumbnail (signed URL via `useQ_Files_ReadUrl`) or file-type icon fallback, filename (ellipsis), file size. Fixed card width (~200px), CSS grid with responsive columns
- [x] Card click: opens `AppEmployee_FilePreviewModal` for that file (reuse existing component). Track `previewFileId` state in the folder modal
- [x] Wire `AppEmployee_FilePreviewModal` inside folder modal with the selected file's context

### Phase C — Cell click routing

Update `handleCellClicked` to route based on file count.

- [x] Add state to `PageEmployees_ListView` (or grid wrapper): `folderModalState: { open, files, employeeId, columnId } | null`
- [x] In `handleCellClicked` `case 'file'`: if folder has 1 file → `onFilePreview` (current behavior); if 2+ files → set `folderModalState` to open the folder modal
- [x] Render `AppEmployee_FolderModal` in the grid's parent, controlled by `folderModalState`

### Phase D — Verification

- [x] tsc clean
- [ ] Manual smoke: single-file cell click → preview modal; multi-file cell → folder modal with cards; card click → preview

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Grid file cells should show a count when a folder has multiple files, and clicking opens a Google Drive-style card browser where each card previews the file.
Tech: `App_EmployeeDataGrid.tsx` (cell renderer + click handler), `AppEmployee_FolderModal.tsx` (new), `AppEmployee_FilePreviewModal.tsx` (reused), `useQ_Tables_OrgFiles` (folderFilesMap), `useQ_Files_ReadUrl` (signed URLs for thumbnails), `PageEmployees_ListView.tsx` (folder modal state host)
Related: [File Storage](https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — R2 signed URLs for card thumbnails
Siblings: 3 total, 0 Done — [AHR-1990 Folders table + data migration (Done local, pending /pp), AHR-1991 Multi-file detail modal (Todo)]
Execution Order: Step 2 of 2 — AHR-1990 done (local) ✓
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
