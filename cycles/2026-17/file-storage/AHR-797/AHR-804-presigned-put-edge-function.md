# Presigned PUT edge function (files_r2_upload-start)

Work Item: AHR-804 (https://plane.jimbui.dev/aiur/browse/AHR-804/)
Tier 1: AHR-797 [v0.0.1 | File Storage] R2 migration + 3-bucket setup + Worker serving (In Progress)
Module: File Storage (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034
Version Doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d

## Context (from spec)

Non-tech: Create the backend door the frontend knocks on to start a file upload — validates who you are, what you're uploading, and where it should go; returns a one-hour upload URL pointing at the right R2 bucket.
Tech: New edge fn `frontend/vite/supabase/functions/files_r2_upload-start/` (Deno). Uses `@aws-sdk/client-s3` v3 + `@aws-sdk/s3-request-presigner` `getSignedUrl`. Reads from `public.employee_contracts`, `public.employees`, `public.employee_columns` for access checks. Uses `is_org_member()` and `is_admin_or_owner()` helpers. Consumed by AHR-806 (`useM_Files_Upload`). Authorizes writes aligning with `files` table RLS (AHR-803).
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — parent module spec.
Siblings: 7 total, 2 Done — AHR-802 R2 infra + Worker bootstrap (Done), AHR-803 files table + RLS (Done), AHR-805 Worker serving + read-JWT (Todo, parallel), AHR-806 useM_Files_Upload (Todo, depends on this), AHR-807 Contract signing migration (Todo), AHR-808 Decommission Supabase Storage (Todo).
Execution Order: Step 2 of 5 — prereqs AHR-802, AHR-803 all Done ✓. Parallel with AHR-805.

## Phase A: Edge function scaffold

- [x] Create `frontend/vite/supabase/functions/files_r2_upload-start/` directory
- [x] Write `deno.json` with imports: `supabase`, `http-server`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- [x] Write `index.ts` boilerplate: CORS headers, `requireEnv()`, `jsonResponse()` helper, `POST/OPTIONS` method gate
- [x] Wire R2 env vars via `requireEnv`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- [x] Instantiate module-scope `S3Client({ region: "auto", endpoint: "https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com", credentials: { accessKeyId, secretAccessKey } })`
- [x] Define constants: `PRESIGNED_URL_EXPIRES_IN = 3600`, `MAX_SIZE_BYTES = 500 * 1024 * 1024`
- [x] JWT user client via `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } })`; call `supabase.auth.getUser()` → reject 401 if missing/invalid

## Phase B: Request validation

- [x] Parse body; validate required shape per `resource_type`: `contract` → `{contract_id, file_name, content_type, size}`; `employee_col` → `{employee_id, column_id, file_name, content_type, size}`; `user_avatar` → `{user_id, file_name, content_type, size}`
- [x] Reject 400 on missing/wrong-type fields with specific error message
- [x] Reject 400 when `size <= 0` or `size > MAX_SIZE_BYTES`
- [x] Reject 400 when `resource_type` not in `["contract", "employee_col", "user_avatar"]`
- [x] Implement `sanitizeFileName()`: NFD normalize → strip `[̀-ͯ]` → replace `[^a-zA-Z0-9._-]` with `_` → collapse `_+` → slice to 200 chars
- [x] Implement `generateRandomId()`: `crypto.randomUUID().replace(/-/g, "").substring(0, 12)`
- [x] Implement `extractExtension(fileName)` for avatar key (lowercased, matches `/\.[^.]+$/`, fallback `"bin"`)

## Phase C: Per-resource-type authorization + key computation

- [x] Build service-role client for DB lookups (separate from user-JWT client used for auth)
- [x] `contract`: SELECT `organization_id` FROM `employee_contracts` WHERE `id = contract_id` → 404 if missing; RPC `is_org_member(org_id)` → 403 if false; key = `orgs/{org_id}/contracts/{contract_id}/{ts}-{uuid12}-{sanitized}`
- [x] `employee_col`: SELECT `organization_id` FROM `employees` WHERE `id = employee_id` → 404 if missing; SELECT `organization_id` FROM `employee_columns` WHERE `id = column_id` → 404 if missing; reject 400 if the two org_ids differ; RPC `is_admin_or_owner(org_id)` → 403 if false; key = `orgs/{org_id}/employees/{employee_id}/{column_id}/{ts}-{uuid12}-{sanitized}`
- [x] `user_avatar`: reject 403 if `user_id !== user.id` (JWT caller); key = `users/{user_id}/avatar-{ts}-{uuid12}.{ext}`

## Phase D: Presign + respond

- [x] Build `PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, ContentType: content_type })`
- [x] `uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN })`
- [x] Compute `expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRES_IN * 1000).toISOString()`
- [x] Return 200 `{ uploadUrl, r2Key, expiresAt }` with CORS + JSON headers
- [x] Wrap logic in try/catch; 500 fallthrough with `console.error` for debugging

## Phase E: Local env + smoke verification

- [x] Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` to `frontend/vite/supabase/functions/.env` (local dev values pointing at `aiurhr--dev`) — keys added to `.env.dev` under `[SUPABASE_FUNCTIONS]`; `R2_ACCOUNT_ID=156c6587f5eeeef516ea33aba5b50fb2`, `R2_BUCKET_NAME=aiurhr--dev` filled; `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` left empty (user to populate from Cloudflare R2 API token)
- [x] Document the four R2 secrets in `frontend/vite/supabase/functions/.env.example`
- [x] Boot `pnpm dev`; curl happy path (user_avatar) → HTTP 200, `uploadUrl` host `aiurhr--dev.156c6587f5eeeef516ea33aba5b50fb2.r2.cloudflarestorage.com`, `r2Key` prefix `users/{user_id}/avatar-`
- [x] PUT tiny byte-stream at `uploadUrl` → HTTP 200 from R2; object landed at returned `r2Key`
- [x] Negative tests: missing auth header → gateway 401; wrong `user_id` → 403; `size > 500MB` → 400; bad `resource_type` → 400; bogus `contract_id` → 404

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Create function directory: (pending)
- Write deno.json: (pending)
- Write index.ts boilerplate: (pending)
- Wire R2 env vars: (pending)
- Instantiate S3Client: (pending)
- Define constants: (pending)
- JWT user client + getUser: (pending)

Phase B: (pending)

- Parse + validate body shape per resource_type: (pending)
- 400 on missing/wrong fields: (pending)
- 400 on size bounds: (pending)
- 400 on resource_type whitelist: (pending)
- sanitizeFileName: (pending)
- generateRandomId: (pending)
- extractExtension: (pending)

Phase C: (pending)

- Service-role client: (pending)
- contract auth + key: (pending)
- employee_col auth + key + org cross-check: (pending)
- user_avatar auth + key: (pending)

Phase D: (pending)

- PutObjectCommand: (pending)
- getSignedUrl: (pending)
- expiresAt: (pending)
- 200 response: (pending)
- try/catch 500 fallthrough: (pending)

Phase E: (pending)

- Add R2 secrets to .env: (pending)
- Document in .env.example: (pending)
- curl smoke (user_avatar): (pending)
- PUT tiny blob → R2 object verification: (pending)
- Negative tests (401/403/400): (pending)
