# Unified FE upload hook (useM_Files_Upload)

Work Item: AHR-806 (https://plane.jimbui.dev/aiur/browse/AHR-806/)
Tier 1: AHR-797 [v0.0.1 | File Storage] R2 migration + 3-bucket setup + Worker serving (In Progress)
Module: File Storage (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034
Version Doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d

## Context (from spec)

Non-tech: A single reusable "upload a file" helper the frontend calls when an admin attaches a file to an employee's dynamic column. Orchestrates the three steps (ask the backend for an upload URL, stream the file to R2, record it in the DB) so individual features don't each reinvent the flow.
Tech: New `frontend/vite/src/hooks/useM_Files_Upload.ts` TanStack mutation hook. Wraps the `files_r2_upload-start` edge fn (AHR-804) + direct R2 PUT + `supabase.from("files").insert(...)`. Reads `useStore_Auth_User()` for `uploaded_by`, invalidates `QueryKeys.files.all()` on success. Size constant centralized in `src/utils/const_FileUpload.ts`.
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — parent module spec.
Siblings: 7 total, 2 Done + 2 local-pending — AHR-802 Worker bootstrap (Done), AHR-803 files table + RLS (Done), AHR-804 Presigned PUT edge fn (Done local, pending /pp), AHR-805 Worker serving + read-JWT (Done local, pending /pp), AHR-807 Contract signing migration (Todo, depends on this + will handle contract uploads inline), AHR-808 Decommission Supabase Storage (Todo).
Execution Order: Step 3 of 5 — prereqs AHR-804, AHR-805 both effectively Done ✓. AHR-807 depends on this.

## Scope

**In this T2:** `resource_type: "employee_col"` only. Params `{file, employee_id, column_id}`, result `{file_id, r2_key}`.

**Deferred to other T2s:** `user_avatar` (Profile T1), `contract` (AHR-807 inline).

## Phase A: Central size constant

- [x] Create `frontend/vite/src/utils/const_FileUpload.ts` exporting `MAX_UPLOAD_SIZE_MB = 50` and `MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024`
- [x] Add brief JSDoc noting this is the product-level gate; edge-fn API-abuse ceiling is separately enforced at 500MB

## Phase B: Hook scaffold

- [x] Create `frontend/vite/src/hooks/useM_Files_Upload.ts`
- [x] Export `UseM_Files_Upload_Params = { file: File; employee_id: string; column_id: string }`
- [x] Export `UseM_Files_Upload_Result = { file_id: string; r2_key: string }`
- [x] Hook shell: `useMutation`, `useQueryClient`, `useStore_Auth_User()`, `App.useApp()` (for message)
- [x] Return `{ mutation }` — single key, no destructuring at call sites

## Phase C: Orchestration

- [x] Size guard — `if (file.size > MAX_UPLOAD_SIZE_BYTES) throw new Error("File exceeds 50MB limit")`
- [x] Derive `contentType = file.type || "application/octet-stream"` (local `const`, used for both edge-fn body and PUT header)
- [x] Invoke `files_r2_upload-start` via `supabase.functions.invoke("files_r2_upload-start", { body: { resource_type: "employee_col", employee_id, column_id, file_name: file.name, content_type: contentType, size: file.size } })`
- [x] Error extraction: reuse the `error.context.json()` parse pattern from `useM_OnboardingInvitation_Send` to surface the edge fn's specific `{error}` message; throw with that message
- [x] Type-assert response data as `{ uploadUrl: string; r2Key: string; expiresAt: string }`
- [x] PUT `fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": contentType } })` → throw `new Error("R2 upload failed: " + response.status)` if `!response.ok`
- [x] Parse `organization_id` — `const segments = r2Key.split("/"); if (segments[0] !== "orgs") throw new Error("Unexpected r2_key shape"); const organization_id = segments[1]`
- [x] Insert row: `supabase.from("files").insert({ r2_key: r2Key, name: file.name, content_type: contentType, size: file.size, uploaded_by: user.id, organization_id }).select("id").single()` → throw if `error` or no `data`
- [x] Return `{ file_id: data.id, r2_key: r2Key }`

## Phase D: Error surfacing + invalidation

- [x] `onSuccess`: `queryClient.invalidateQueries({ queryKey: QueryKeys.files.all() })` — no `message.success` (caller handles toast)
- [x] `onError`: `console.error(err)` + `message.error(err instanceof Error ? err.message : "Upload failed")`

## Phase E: Smoke / verification

- [x] `pnpm tsc --noEmit` from `frontend/vite/` — 0 new errors in `useM_Files_Upload.ts` / `const_FileUpload.ts` (3 pre-existing unrelated errors in auth forms + main.tsx)
- [ ] Add a throwaway `<input type="file">` + `<button>` in a dev-visible location (e.g. top of `Page_Employees`) wired to the hook with a hardcoded `employee_id` + `column_id` from the seeded DB → upload a small test file — DEFERRED: runtime smoke waits until real caller (AHR-807 contract signing migration OR future file-column UI) exercises the hook
- [ ] Verify: `files` row appears (via Supabase Studio), R2 object exists in `aiurhr--dev`, returned `file_id` matches the DB row's `id` — DEFERRED (same)
- [ ] Oversize test: try uploading a 60MB dummy file → hook rejects immediately with "File exceeds 50MB limit", no network calls — DEFERRED (same)
- [ ] Empty `file.type` test: upload a file with blank type (e.g. rename to `.weirdext`) → succeeds with `content_type: "application/octet-stream"` on the row — DEFERRED (same)
- [x] No throwaway UI added — nothing to remove

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Create const_FileUpload.ts: (pending)
- JSDoc on MAX_UPLOAD_SIZE_MB: (pending)

Phase B: (pending)

- Create useM_Files_Upload.ts: (pending)
- Params + Result types: (pending)
- Hook shell + deps: (pending)
- Return mutation: (pending)

Phase C: (pending)

- Size guard: (pending)
- contentType derivation: (pending)
- Invoke upload-start: (pending)
- Error extraction from edge fn: (pending)
- Response type assertion: (pending)
- PUT to R2: (pending)
- Parse organization_id: (pending)
- Insert files row: (pending)
- Return result: (pending)

Phase D: (pending)

- onSuccess invalidation: (pending)
- onError feedback: (pending)

Phase E: (pending)

- tsc check: (pending)
- Throwaway UI smoke: (pending)
- Oversize rejection test: (pending)
- Empty file.type test: (pending)
- Remove throwaway UI: (pending)
