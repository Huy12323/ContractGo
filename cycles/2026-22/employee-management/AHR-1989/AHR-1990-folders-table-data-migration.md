# Folders table + data migration

> Version: [Outline](https://outline.jimbui.dev/doc/47cbc890-7561-4483-beb5-4b3a0da7cc94) | Tier 1: [AHR-1989](https://plane.jimbui.dev/aiur/browse/AHR-1989/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)

## Requirements

- New `folders` table exists with org-scoped RLS policies (SELECT is_org_member, INSERT/UPDATE/DELETE is_admin_or_owner)
- `files` table has a `folder_id` FK column linking files to their parent folder
- Existing single-file cell values are migrated: each existing file gets a folder, cell value changes from `files.id` to `folders.id`
- After migration, all existing files remain accessible — no regressions in grid cell display, detail modal view/edit, or preview modal
- New file uploads through the existing single-file flow continue working (folder auto-created)

## Scope boundaries

- No edge function changes — `files_r2_upload-start`, `files_r2_sign-read-url`, `files_r2_delete` remain unchanged
- R2 storage paths unchanged — folder is a DB-only concept
- Multi-file upload/remove UI is T2-2 (AHR-1991) — this T2 only makes single-file work through the folder layer
- Multi-file grid display is T2-3 (AHR-1992) — this T2 renders first file only (backwards compat)

## Decisions

- **Decision:** `folders` table is minimal — `id` (generate_id('fol')), `organization_id` NOT NULL FK, timestamps. No name, no nesting.
  **Rationale:** Folders are invisible infrastructure. Users see "files in a field", not "a folder".
- **Decision:** `files.folder_id` uses `ON DELETE CASCADE`.
  **Rationale:** If a folder is deleted, its file rows cascade-delete. App handles R2 cleanup before folder deletion.
- **Decision:** Replace reuses the existing folder — cell value (folder_id) stays unchanged.
  **Rationale:** Stable cell value simplifies optimistic updates and avoids unnecessary writes.
- **Decision:** `useQ_Tables_OrgFiles` updated with `folder_id` + `folderFilesMap`. No separate folders hook.
  **Rationale:** Files already prefetched. Adding `folder_id` to existing query and grouping client-side avoids a second round-trip.
- Original Estimate: 3 points

## Implementation

### Phase A — Database migration

Create `folders` table, add `folder_id` FK to `files`, migrate existing file column data. Single migration file.

- [x] Create `folders` table: `id TEXT PK DEFAULT generate_id('fol')`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `created_at`, `updated_at`. Index on `organization_id`. `handle_updated_at()` trigger.
- [x] Enable RLS on `folders`: SELECT `is_org_member(organization_id)`, INSERT/UPDATE/DELETE `is_admin_or_owner(organization_id)`
- [x] Add `folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE` to `files`. Index `idx_files_folder_id`
- [x] Data migration DO block: query `employee_columns WHERE type = 'file'`, for each column iterate the entity's dynamic table (`ent_<entity_id>__employees`), for each non-null cell value create a folder (inheriting `organization_id` from the file row), set `files.folder_id`, update cell value from `files.id` to `folders.id`
- [x] Run `/backup` then `supabase db push --local`

### Phase B — Folder-aware data layer

Update existing hooks to resolve folder → files for rendering.

- [x] Regenerate TS types: `pnpm sb:dev:types`
- [x] Update `useQ_Tables_OrgFiles`: add `folder_id` to SELECT columns, build `folderFilesMap: Record<string, OrgFileRecord[]>` grouped by `folder_id` (sorted by `created_at`), export from return object alongside existing `filesMap`
- [x] Update `useM_Files_Upload`: accept optional `folder_id` param, include it in the `files.insert()` call when provided

### Phase C — Update renderers for folder-based lookup

Grid cell and detail modal resolve cell value as folder_id instead of file_id.

- [x] Grid cell `case 'file'`: change from `filesMap[cellValue]` to `folderFilesMap[cellValue]?.[0]` — first file in folder. Update thumbnail URL lookup to resolve through folder (folder → files[0] → thumbnail_r2_key)
- [x] Detail modal `FileFieldView`: resolve `folderFilesMap[value]?.[0]` to get filename for display
- [x] Detail modal `FileFieldEdit`: resolve folder → files[0] for Replace/Remove states. On Replace, existing file in folder is the one to delete. On Remove, `__delete` marker uses files[0].id
- [x] Save orchestrator update: on `File` upload — create folder via `supabase.from('folders').insert({organization_id}).select('id').single()`, then upload file with `folder_id`, store `folder_id` in cell. On replace — reuse existing folder (upload new file with same folder_id, delete old file). On remove — delete file via edge fn, delete folder via `supabase.from('folders').delete().eq('id', folderId)`, set cell to `null`

### Phase D — Verification

- [x] tsc clean — no type errors
- [ ] Manual smoke: create file column, upload file → verify folder created + cell stores folder_id, grid renders filename, detail modal shows file, replace file → verify folder reused, remove file → verify folder + file deleted, cell null

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Employee file columns currently hold one file each. This T2 adds a "folders" DB layer so each cell points to a folder that can hold multiple files, while keeping the single-file UX working identically.
Tech: `folders` table (new), `files.folder_id` FK (new), `useQ_Tables_OrgFiles` (update), `useM_Files_Upload` (update), `App_EmployeeDataGrid.tsx` grid cell (update), `AppEmployeeDetailModal_FieldRenderer.tsx` (update), `App_EmployeeDetailModal.tsx` save orchestrator (update), per-entity dynamic tables `ent_<entityId>__employees` (data migration)
Related: [File Storage](https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — R2 infra, files table, upload/delete edge functions (unchanged)
Siblings: 3 total, 0 Done — [AHR-1991 Multi-file detail modal (Todo), AHR-1992 Multi-file grid cell display (Todo)]
Execution Order: Step 1 of 2 — foundation, no prerequisites
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
