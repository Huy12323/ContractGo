# Worker auth-gated serving + read-JWT minter

Work Item: AHR-805 (https://plane.jimbui.dev/aiur/browse/AHR-805/)
Tier 1: AHR-797 [v0.0.1 | File Storage] R2 migration + 3-bucket setup + Worker serving (In Progress)
Module: File Storage (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034
Version Doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d

## Context (from spec)

Non-tech: The serving side of R2 — a Cloudflare Worker that hands back private files only to users who have a valid short-lived token, plus a backend endpoint that mints those tokens. Avatars are served publicly through the same Worker (no token) so `<img>` tags work without a round-trip.
Tech: Fills `cloudflare/workers/files/src/index.js` (currently bootstrap stub from AHR-802). Adds `frontend/vite/supabase/functions/files_r2_sign-read-url/`. Uses `jose` HS256, reads `files.r2_key` via service-role client, reuses `isOrgMember` / `isOrgAdminOrOwner` patterns from `files_r2_upload-start` (AHR-804). New shared secret `WORKER_JWT_SECRET` routed to both Worker `.dev.vars` and edge-fn `.env`.
Related: File Storage (https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034) — parent module spec.
Siblings: 7 total, 2 Done + 1 local-pending — AHR-802 Worker bootstrap (Done), AHR-803 files table + RLS (Done), AHR-804 Presigned PUT edge fn (Done local, pending /pp), AHR-806 useM_Files_Upload (Todo, depends on AHR-804), AHR-807 Contract signing migration (Todo, depends on this), AHR-808 Decommission Supabase Storage (Todo).
Execution Order: Step 2 of 5 — prereqs AHR-802, AHR-803 all Done ✓. Parallel with AHR-804 (which is also effectively done).

## Phase A: Dependencies + shared secret wiring

- [x] Add `jose` to Worker package: `pnpm --filter aiur-hr-files-worker add jose`
- [x] Add `jose` to edge-fn `deno.json` imports: `"jose": "npm:jose@5"`
- [x] Add `WORKER_JWT_SECRET` to `.env.example` SHARED block + reference under `[SUPABASE_FUNCTIONS]` and `[WORKER_FILE_STORAGE]`
- [x] Add concrete `WORKER_JWT_SECRET` to `.env.dev` (dev value, min 32 chars, documented as throwaway)
- [x] Run `pnpm env:apply:dev`; verify `frontend/vite/supabase/functions/.env` and `cloudflare/workers/files/.dev.vars` both contain `WORKER_JWT_SECRET`
- [x] Document production provisioning in `cloudflare/workers/files/README.md`: `wrangler secret put WORKER_JWT_SECRET --env {staging,production}` + mirror in Supabase Dashboard → Edge Functions → Secrets

## Phase B: Worker JWT verification + path enforcement

- [x] Replace bootstrap stub in `cloudflare/workers/files/src/index.js` with full handler
- [x] Import `jose.jwtVerify`; handle OPTIONS (CORS preflight) + GET only (other methods → 405)
- [x] Extract URL path → `r2Key = pathname.slice(1)` (strip leading `/`)
- [x] Reject 404 if `r2Key` is empty
- [x] Branch on path prefix BEFORE auth: `r2Key.startsWith("users/") && r2Key.includes("/avatar-")` → skip to Phase C serving (no JWT); `r2Key.startsWith("orgs/")` → proceed to JWT check; else → 403 "Unknown path namespace"
- [x] For `orgs/*`: read `?token=` → 401 "Missing token" if absent
- [x] `jwtVerify(token, secretBytes, { algorithms: ["HS256"] })` → catch `JWTExpired` → 401 "Token expired"; any other error → 401 "Invalid token"
- [x] Assert `payload.r2Key === r2Key` → 401 "Token/path mismatch"
- [x] Assert `payload.env === env.ENVIRONMENT` → 401 "Token env mismatch"
- [x] Assert `payload.orgId` present → 401 "Missing org claim"

## Phase C: Worker R2 streaming + cache strategy

- [x] `getCacheStrategy(r2Key)` helper:
    - `r2Key.startsWith("users/") && r2Key.includes("/avatar-")` → `{ shared: true, ttl: 3600 }`
    - Extension in `[png,jpg,jpeg,gif,webp,svg,avif,mp4,webm,mov]` → `{ shared: true, ttl: 604800 }`
    - Extension `pdf` → `{ shared: false, ttl: 300 }`
    - Extension in `[docx,xlsx,pptx,txt,csv]` → `{ shared: false, ttl: 0, noCache: true }`
    - Else → `{ shared: false, ttl: 0, noCache: true }`
- [x] Build `cacheKey`: shared → `new Request(new URL('/' + r2Key, url.origin))` (token stripped); private → skip CF edge cache entirely
- [x] Check `caches.default.match(cacheKey)` for shared content → return cached Response if hit
- [x] `env.FILES_BUCKET.get(r2Key)` → 404 "File not found" if null
- [x] Build Response with body `object.body`, headers: `Content-Type` (from `object.httpMetadata?.contentType`), `Content-Length`, `ETag: object.httpEtag`, `Cache-Control` (per strategy), `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`
- [x] For shared content: `ctx.waitUntil(caches.default.put(cacheKey, response.clone()))`
- [x] Catch-all try/catch → log + return 500

## Phase D: Edge function files_r2_sign-read-url scaffold + auth

- [x] Create `frontend/vite/supabase/functions/files_r2_sign-read-url/` with `deno.json` (supabase + jose) and `index.ts`
- [x] Boilerplate copied from `files_r2_upload-start`: `requireEnv`, `jsonResponse`, CORS, POST/OPTIONS gate
- [x] Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_JWT_SECRET`, `VITE_R2_WORKER_URL`, `ENVIRONMENT`
- [x] User-JWT client `auth.getUser()` → 401 if missing/invalid
- [x] Parse body: `{resource_type, file_id}` + resource-specific IDs (`contract_id` | `{employee_id, column_id}`)
- [x] Validate `resource_type ∈ ["contract", "employee_col"]` (no `user_avatar` — return 400 with hint "Avatar URLs are constructed directly by the client from r2_key")
- [x] Copy `isOrgMember` + `isOrgAdminOrOwner` helpers from `files_r2_upload-start` (consider extracting to `shared--`/file later; not this T2)
- [x] For `contract`: lookup `employee_contracts.organization_id` by `contract_id` → 404 if missing; `isOrgMember(orgId, user.id)` → 403 if false
- [x] For `employee_col`: lookup `employees.organization_id` + `employee_columns.organization_id` → 404 if either missing; assert same → 400 if different; `isOrgAdminOrOwner(orgId, user.id)` → 403 if false

## Phase E: Edge function file lookup + JWT mint + URL build

- [x] SELECT `r2_key, organization_id` FROM `files` WHERE `id = file_id` → 404 "File not found" if missing
- [x] Cross-check file's `organization_id` matches the resource's `organization_id` → 403 "File does not belong to this resource's org"
- [x] Compute `env = Deno.env.get("ENVIRONMENT") || "development"`
- [x] Build JWT payload `{userId: user.id, orgId, r2Key, resourceId: file_id, resourceType: resource_type, env}`
- [x] Sign: `new SignJWT(payload).setProtectedHeader({alg: "HS256"}).setIssuedAt().setExpirationTime("7d").sign(secret)`
- [x] Compute `expiresAt = new Date(Date.now() + 7*24*3600*1000).toISOString()`
- [x] Build URL: `${VITE_R2_WORKER_URL}/${r2Key}?token=${jwt}`
- [x] Return 200 `{url, expiresAt}`

## Phase F: Smoke verification

- [x] Worker live on `http://localhost:8787` (verified via `curl /` → `{"error":"Missing path"}` 404 = new handler active)
- [x] GET avatar directly (no token) → 200, `Cache-Control: public, max-age=3600`, `Content-Type: image/png`, body matches previous AHR-804 PUT (`test-avatar-bytes`, 17 bytes)
- [x] Tamper: GET `/users/nobody/avatar-xyz.png` → 404 "File not found"
- [x] Unknown namespace → 403 "Unknown path namespace"
- [x] `orgs/` without token → 401 "Missing token"
- [ ] Sign up throwaway user, upload an avatar via `files_r2_upload-start`, insert `files` row manually, call `files_r2_sign-read-url` with `{resource_type: "user_avatar"}` → expect 400 — BLOCKED: needs `pnpm dev` restart to load edge fn
- [ ] Seed test org + contract + upload a PDF via `files_r2_upload-start`, insert `files` row, call `files_r2_sign-read-url` for contract → expect 200 + signed URL — BLOCKED (same)
- [ ] GET signed URL → expect 200 with PDF content — BLOCKED (same)
- [ ] Tamper: bad token → 401; path mismatch → 401; expired token → 401 — BLOCKED (same)
- [ ] Cleanup test user, files rows, R2 objects — BLOCKED (same)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Add jose to Worker: (pending)
- Add jose to edge-fn deno.json: (pending)
- .env.example WORKER_JWT_SECRET: (pending)
- .env.dev WORKER_JWT_SECRET: (pending)
- env:apply:dev verification: (pending)
- Document prod secret provisioning: (pending)

Phase B: (pending)

- Replace bootstrap stub: (pending)
- OPTIONS/GET gate: (pending)
- URL path extract: (pending)
- Empty r2Key 404: (pending)
- Path prefix branch: (pending)
- Token extraction: (pending)
- jwtVerify + error mapping: (pending)
- r2Key mismatch assert: (pending)
- env mismatch assert: (pending)
- orgId claim assert: (pending)

Phase C: (pending)

- getCacheStrategy helper: (pending)
- cacheKey construction: (pending)
- CF cache lookup: (pending)
- R2 get + 404: (pending)
- Response headers: (pending)
- ctx.waitUntil cache put: (pending)
- try/catch 500: (pending)

Phase D: (pending)

- Function dir + deno.json: (pending)
- Boilerplate + env vars: (pending)
- User-JWT client auth: (pending)
- Body parse + resource_type whitelist: (pending)
- user_avatar 400 with hint: (pending)
- Auth helpers copied: (pending)
- contract auth path: (pending)
- employee_col auth path: (pending)

Phase E: (pending)

- Files row lookup: (pending)
- Org cross-check: (pending)
- JWT payload + sign: (pending)
- expiresAt + URL build: (pending)
- 200 response: (pending)

Phase F: (pending)

- Worker boot check: (pending)
- Avatar upload + PUT: (pending)
- Files row insert: (pending)
- user_avatar sign-url 400: (pending)
- Avatar GET (no token) 200: (pending)
- Wrong avatar path 404: (pending)
- Contract upload + files row: (pending)
- Contract sign-url 200: (pending)
- Contract GET 200: (pending)
- Bad token 401: (pending)
- Path mismatch 401: (pending)
- Expired token 401: (pending)
- Cleanup: (pending)
