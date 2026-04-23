# Table cell — render + upload + download

Work Item: AHR-1495 (https://plane.jimbui.dev/aiur/browse/AHR-1495/)
Tier 1: AHR-1492 [v0.0.1 | Employee Management] File column type (In Progress)
Module: Employee Management (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/)
Outline Spec: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802
Version Doc: https://outline.jimbui.dev/doc/5d80c0fb-cf52-4785-a819-f84c92251b56

## Context (from spec)

Non-tech: Users can see a file attached to an employee column, preview it inline (images + PDFs), download it, upload a new file, or remove an existing one. Upload is deferred until the user saves the detail modal (no orphans from cancelled edits). Remove actively cleans the R2 object and the files row via a new edge function.
Tech: New hooks `useQ_Tables_OrgFiles` (files metadata prefetch) + `useQ_Files_ReadUrl` (on-demand signed URL). New `AppEmployee_FilePreviewModal` (MIME-based preview + download button). Grid cell renders filename; click opens preview. Detail modal FieldRenderer gets view (link) + edit (file picker with delayed upload, remove with delete marker). Modal save orchestrator resolves `File` instances and `__delete` markers before `useM_Employee_Update`. New edge fn `files_r2_delete` for active cleanup.
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — consumed via `useM_Files_Upload` + `files_r2_sign-read-url`.
Siblings: 2 total, 2 Done local — AHR-1493 Schema + edge fn (Done local, pending /pp), AHR-1494 Field composer (Done local, pending /pp)
Execution Order: Step 2 of 2 — AHR-1493 ✓, parallel with AHR-1494 ✓

## Phase A: Data hooks

- [x] Create `frontend/vite/src/hooks/useQ_Tables_OrgFiles.ts` — `supabase.from("files").select("id, name, content_type, size")` filtered by current org (via `useStore_Auth_User` + active org context); returns `{query, files, filesMap}` with `filesMap: Record<file_id, FileRecord>` for O(1) lookup
- [x] Create `frontend/vite/src/hooks/useQ_Files_ReadUrl.ts` — params `{file_id, employee_id, column_id}`; calls `supabase.functions.invoke("files_r2_sign-read-url", { body: {resource_type: "employee_col", file_id, employee_id, column_id} })`; returns `{query, url, expiresAt}`; `enabled: !!file_id`, `staleTime: 6 * 24 * 3600 * 1000`
- [x] QueryKeys pattern: `[...QueryKeys.files.list(), { orgId }]` for org files; `[...QueryKeys.files.record(file_id), "read-url", { employee_id, column_id }]` for signed URL

## Phase B: Preview modal component

- [x] Create `frontend/vite/src/components/employees/AppEmployee_FilePreviewModal.tsx`
- [x] Props: `{ open, file_id, employee_id, column_id, onClose }`
- [x] Uses `useQ_Tables_OrgFiles.filesMap[file_id]` for filename/content_type + `useQ_Files_ReadUrl` for signed URL
- [x] MIME branching in body:
    - `content_type.startsWith("image/")` → `<img src={url} style={{ maxWidth: '100%', maxHeight: '70vh' }} />`
    - `content_type === "application/pdf"` → `<iframe src={url} style={{ width: '100%', height: '70vh', border: 0 }} />`
    - Else → centered paperclip icon + filename + `<Typography.Text type="secondary">{content_type}</Typography.Text>`
- [x] Footer: single "Download" button → `<a href={url} download={filename}>` programmatically clicked (forces download prompt vs inline view)
- [x] Loading state while signed URL is fetching; error state on mint failure

## Phase C: Grid cell render + click-to-preview

- [x] `App_EmployeeDataGrid.tsx` `getCellContent` `case 'file':` — `GridCellKind.Text`, `data: filesMap[value]?.name ?? value`, `displayData` same, `allowOverlay: false`
- [x] Wire `filesMap` through prop from List View
- [x] `handleCellClicked`: add branch — if `field.type === 'file'` and `value` is truthy → call `onFilePreview?.({file_id: value, employee_id: record.id, column_id: field.key})` prop
- [x] New prop on `App_EmployeeDataGrid`: `onFilePreview?: (ctx) => void`
- [x] `PageEmployees_ListView.tsx` hosts `previewContext` state; passes callback to grid; renders `<AppEmployee_FilePreviewModal>` at root

## Phase D: Detail modal FieldRenderer — view mode

- [x] `AppEmployeeDetailModal_FieldRenderer.tsx` view mode `case 'file':`
- [x] When `isEmpty(value)` → existing Null placeholder (no change)
- [x] Otherwise: `<Typography.Link onClick={() => onPreview?.(value)}><PaperClipOutlined /> {filesMap[value]?.name ?? value}</Typography.Link>`
- [x] New optional prop `onPreview?: (file_id: string) => void` on FieldRenderer; wired from `AppEmployeeDetailModal_DetailsTab` → `App_EmployeeDetailModal` which hosts its own `previewContext` state + renders the preview modal

## Phase E: Detail modal FieldRenderer — edit mode (delayed upload)

- [x] `AppEmployeeDetailModal_FieldRenderer.tsx` edit mode `case 'file':`
- [x] State rendering decision tree:
    - `value instanceof File` → "Ready to upload: {file.name}" + "Cancel" button (reverts to previous value or empty)
    - `value` is a string file_id → filename + "Replace" + "Remove" buttons
    - `value` is `{__delete: true, file_id}` → "Marked for removal: {previousName}" + "Undo" (reverts to file_id)
    - `isEmpty(value)` → "Choose file" button only
- [x] Hidden `<input type="file">` + visible `<Button>` wrapper for file picker
- [x] On pick: `onChange(file)` passes the `File` object directly (not uploaded yet)
- [x] On "Remove": `onChange({__delete: true, file_id: currentValue})`

## Phase F: Modal save orchestrator (upload + delete + persist)

- [x] Locate the modal save path in `App_EmployeeDetailModal.tsx` (or wherever `useM_Employee_Update.mutation.mutate(patch)` is called)
- [x] Before calling update: iterate patch entries
    - If `value instanceof File` → await `mFilesUpload.mutation.mutateAsync({file: value, employee_id, column_id: fieldKey})` → replace with returned `file_id`
    - If value matches `{__delete: true, file_id}` → await `supabase.functions.invoke("files_r2_delete", {body: {file_id}})` → replace with `null`
    - Else pass through
- [x] If any upload/delete fails: surface error, abort save (keep modal open with patch intact so user can retry)
- [x] After normalization: call existing `useM_Employee_Update.mutation.mutate(normalizedPatch)`
- [x] Invalidate `QueryKeys.files.all()` on success (for filename display refresh)

## Phase G: files_r2_delete edge function

- [x] Create `frontend/vite/supabase/functions/files_r2_delete/` with `deno.json` (same imports as upload-start: supabase + @aws-sdk/client-s3)
- [x] Copy boilerplate from `files_r2_upload-start`: `requireEnv`, `jsonResponse`, CORS, POST/OPTIONS gate, user-JWT + service-role clients, `auth.getUser()` gate
- [x] R2 env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (reuse existing)
- [x] Body: `{file_id}` — validate non-empty
- [x] Lookup: `SELECT r2_key, organization_id FROM files WHERE id = file_id` via service role → 404 if missing
- [x] Authorization: `isOrgAdminOrOwner(file.organization_id, user.id)` (copy helper from upload-start) → 403 if false
- [x] R2 delete: `s3.send(new DeleteObjectCommand({Bucket, Key: file.r2_key}))` — log on error but continue (orphan tolerance if R2 deletion fails intermittently)
- [x] DB delete: `DELETE FROM files WHERE id = file_id` via service role
- [x] Return 200 `{success: true}`

## Phase H: Smoke (user-driven)

- [x] `pnpm tsc --noEmit` → 0 new errors
- [ ] Restart `pnpm dev` so new edge fn `files_r2_delete` is discovered — USER TO VERIFY
- [ ] User runtime walkthrough (all 8 steps) — USER TO VERIFY

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- useQ_Tables_OrgFiles: (pending)
- useQ_Files_ReadUrl: (pending)
- QueryKeys spread patterns: (pending)

Phase B: (pending)
- Preview modal scaffold: (pending)
- MIME-based preview body: (pending)
- Download button: (pending)

Phase C: (pending)
- getCellContent file case: (pending)
- filesMap prop wiring: (pending)
- handleCellClicked file branch: (pending)
- List View preview state hosting: (pending)

Phase D: (pending)
- FieldRenderer view mode file case: (pending)
- onPreview prop propagation: (pending)

Phase E: (pending)
- Edit mode state rendering tree: (pending)
- File picker wiring: (pending)
- Remove/Undo buttons: (pending)

Phase F: (pending)
- Locate modal save path: (pending)
- Upload orchestration: (pending)
- Delete orchestration: (pending)
- Error handling: (pending)

Phase G: (pending)
- deno.json + boilerplate: (pending)
- Auth + lookup + delete: (pending)
- Error paths: (pending)

Phase H: (pending)
- tsc check: (pending)
- User runtime smoke: (pending)
