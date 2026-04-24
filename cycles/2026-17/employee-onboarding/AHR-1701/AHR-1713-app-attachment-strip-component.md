# App_AttachmentStrip component

Work Item: AHR-1713 (https://plane.jimbui.dev/aiur/browse/AHR-1713/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: File-type custom columns currently render as broken text-input cards in the contract's left-side field list (Pre-fill). This T2 builds a new horizontal attachment-card strip that replaces those cards — thumbnail preview + filename + upload/replace/remove actions per file. The strip is designed to live **inside the right column, stacked above the TipTap body** (same width as the contract preview, not full-width). AHR-1715 will wire it into the four composite surfaces (composer preview, HR pre-fill, review modal, employee fill) and restructure the right column into a vertical flex.

Tech: New component `frontend/vite/src/components/employees/App_AttachmentStrip.tsx` with an inner `Card_Attachment` sub-component in the same file. Each card owns its own `useM_Files_Upload` + `useQ_Files_ReadUrl` instances — immediate-persist UX matching the contract fill pattern. Thumbnail rendered from signed R2 URL (`use_thumbnail: true`); fallback to ANTD TwoTone React icon keyed by content_type (new `Utils_FileTypeIcon_Component` helper added alongside the existing `Utils_FileTypeIcon_DataUri` in `frontend/vite/src/utils/Utils_FileTypeIcon.ts` — same mime→icon mapping, DOM variant instead of canvas data URI). New thin `useM_Files_Delete` hook wraps the `files_r2_delete` edge function for Remove + Replace orphan cleanup. Props mirror `App_FieldRenderer` / `App_ContractFiller` conventions: `mode: 'fill' | 'readonly'`, `fillerRole: 'hr' | 'employee'`, `fieldStates: Record<fieldKey, 'hr' | 'mandatory' | 'optional'>`, `errors?: Record<fieldKey, string>`.

Related: `App_FieldRenderer` (parallel primitive — shares `fieldStateTagColor` / `fieldStateTagLabel` helpers for the state tag), `useM_Files_Upload` (extended in AHR-1711 to emit thumbnails), `useQ_Files_ReadUrl` (extended in AHR-1711 with `use_thumbnail` flag), `useQ_Tables_OrgFiles` (filesMap for filename + content_type + thumbnail_r2_key lookup by file_id), `Utils_FileTypeIcon` (ANTD TwoTone palette — canvas data URI variant already exists for the Glide grid consumer, DOM React-component variant added here), `files_r2_delete` edge function (already deletes r2_key + thumbnail_r2_key R2 objects + files row in one call).

Siblings: 6 total, 4 Done (local, pending /pp) — AHR-1705 Schema (Done local), AHR-1707 Image utility (Done local), AHR-1709 Doc microservice (Cancelled), AHR-1711 Upload flow (Done local), AHR-1715 Wire strip (Not started), AHR-1790 Grid thumbnails (Done local)

Execution Order: Step 4 of 5 — prereq AHR-1711 (upload flow emits thumbnails) effectively Done; unblocks AHR-1715 (strip wiring into composite surfaces).

## Phase A: Strip container + card display (ready state)

- [x] Create `frontend/vite/src/components/employees/App_AttachmentStrip.tsx` with exported `App_AttachmentStrip` + private `Card_Attachment` sub-component in the same file
- [x] Define Props: `fields: Array<{ fieldKey; fieldLabel; fieldType }>` (accepts ALL contract fields — strip filters to `fieldType === 'file'` internally so callers don't duplicate the filter), `fieldValues: Record<string, unknown>`, `onChange: (fieldKey: string, value: unknown) => void`, `mode: 'fill' | 'readonly'`, `fillerRole: 'hr' | 'employee'`, `fieldStates: Record<string, 'hr' | 'mandatory' | 'optional'>`, `employee_id: string`, `organization_id: string`, `errors?: Record<string, string>`. `return null` when zero file-type fields (parent handles the vertical gap)
- [x] Strip outer layout: vertical flex containing an "Attachments (N)" heading (`Typography.Text strong` matching the left-column "Pre-fill (N)" header style — symmetry, so the parent in AHR-1715 does not need to add its own heading) + a horizontal flex row below with `overflow-x: auto`, `gap: token.marginSM`, token-driven padding. Each `Card_Attachment` has a fixed width (~140px)
- [x] `Card_Attachment` sub-component signature: `{ field, fileId, mode, fillerRole, fieldState, employee_id, organization_id, onChange, error }`. Looks up `filesMap[fileId]` → `{ name, content_type, thumbnail_r2_key }` via `useQ_Tables_OrgFiles({ organizationId })`
- [x] Extend `frontend/vite/src/utils/Utils_FileTypeIcon.ts` with `Utils_FileTypeIcon_Component(mime: string): { Icon: React.FC<{ style?: React.CSSProperties }>; primary: string; secondary: string }` — same mime→icon mapping as the existing `_DataUri` export, but returns the ANTD TwoTone React components from `@ant-design/icons` (`FilePdfTwoTone`, `FileWordTwoTone`, etc., not the serialized `-svg` variants). Reuses the same `COLORS` palette for consistency with the grid cells
- [x] Ready-state thumbnail slot: if `filesRow?.thumbnail_r2_key` is present → `useQ_Files_ReadUrl({ file_id: fileId, employee_id, column_id: field.fieldKey, use_thumbnail: true })` → `<img src={url}>` (no `crossOrigin` needed — DOM `<img>` doesn't taint a canvas). Else → `<Icon twoToneColor={primary}>` via `Utils_FileTypeIcon_Component(content_type)`
- [x] Filename rendered below the thumbnail slot via `Typography.Text ellipsis style={{ fontSize: 11 }}` (token-driven color). State tag below the filename via `<Tag color={fieldStateTagColor(fieldState)}>{fieldStateTagLabel(fieldState)}</Tag>` — imports reused from `App_FieldRenderer` (no duplication)
- [x] Preview-on-click: click anywhere on the thumbnail/filename area → fetch signed original URL (direct `supabase.functions.invoke('files_r2_sign-read-url')` rather than a second lazy `useQ_Files_ReadUrl` instance — avoids mounting a parallel query that never fires) → `window.open(url, '_blank', 'noopener,noreferrer')`. Readonly mode still supports preview (view-only ≠ no view). Action buttons stop propagation so their clicks do not also trigger preview

## Phase B: Card interactions (upload / replace / remove / error)

- [x] Create `frontend/vite/src/hooks/useM_Files_Delete.ts` following the project's `ext-tanstack-query-mutation` shape — `mutationFn` invokes `supabase.functions.invoke('files_r2_delete', { body: { file_id } })` with standard error-body extraction. `onSuccess` invalidates `QueryKeys.files.all()`. `onError` logs + surfaces `message.error` via `App.useApp()`. Returns `{ mutation }`. Used by Remove (awaited) + Replace cleanup (fire-and-forget)
- [x] Empty state (no `fileId`): card renders a dashed-border slot with a centered `<UploadOutlined>` icon + "Upload" label; clicking opens a hidden `<input type="file">` (no `accept` attribute → all MIME types accepted per Q4). On file pick → `mFilesUpload.mutate({ file, employee_id, column_id: field.fieldKey })` → `onSuccess(result)` → `onChange(field.fieldKey, result.file_id)`
- [x] Uploading state: while `mFilesUpload.isPending`, overlay `<Spin>` over the thumbnail slot with an "Uploading…" caption; hide action buttons. The failing-file is retained in a local `useState` so Retry can re-invoke the mutation with the same File
- [x] Failed state: `mFilesUpload.isError` → red `Typography.Text type="danger" style={{ fontSize: 11 }}` with `mutation.error.message` + a Retry button that re-calls `mFilesUpload.mutate({ file: lastFile, ... })`
- [x] Replace: in ready state, a "Replace" button (small, borderless per `ext-antd-components` toolbar convention) → opens the same file picker → new upload → `onSuccess(result)` → fire-and-forget `mFilesDelete.mutate(oldFileId)` for orphan cleanup (best-effort, matches the existing `App_EmployeeDetailModal.saveChanges` pattern) → `onChange(field.fieldKey, result.file_id)`
- [x] Remove: "Remove" button (small, `danger`) → `App.useApp().modal.confirm({ title: 'Remove attachment?', okType: 'danger', okText: 'Remove' })` → `await mFilesDelete.mutateAsync(fileId)` → `onChange(field.fieldKey, null)`
- [x] Edit gating: if `mode === 'readonly'` OR (`fillerRole === 'employee' && fieldState === 'hr'`) → render card in view-only shape (thumbnail + filename + state tag + preview-on-click only; hide Upload/Replace/Remove + the hidden file-picker input)
- [x] Per-field error: when `errors[field.fieldKey]` is non-empty, render `Typography.Text type="danger" style={{ fontSize: 11 }}` immediately below the card (outside the card's border, mirroring the `App_FieldRenderer` error layout)

## Phase C: Verify

- [x] `pnpm type-check` passes with only the three pre-existing errors (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`); no new errors from this T2
- [~] Visual smoke deferred to AHR-1715. Rationale: an agent can't eyeball — a throwaway stub in `App_FormBuilderModal` would have to be manually verified by the user then reverted before /pp. AHR-1715 wires the strip into the four composite surfaces for real, which is the natural smoke-test point. Component is self-contained + typesafe in isolation; integration visuals surface naturally during AHR-1715

---

## Plane IDs (populated by /pp)

Phase A: AHR-1827
- Task 1: AHR-1830
- Task 2: AHR-1831
- Task 3: AHR-1832
- Task 4: AHR-1833
- Task 5: AHR-1834
- Task 6: AHR-1835
- Task 7: AHR-1836
- Task 8: AHR-1837

Phase B: AHR-1828
- Task 1: AHR-1838
- Task 2: AHR-1839
- Task 3: AHR-1840
- Task 4: AHR-1841
- Task 5: AHR-1842
- Task 6: AHR-1843
- Task 7: AHR-1844
- Task 8: AHR-1845

Phase C: AHR-1829
- Task 1: AHR-1846
- Task 2: AHR-1847
