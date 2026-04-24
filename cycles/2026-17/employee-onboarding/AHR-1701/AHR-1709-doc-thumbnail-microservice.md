# Doc thumbnail microservice (Node + sharp container)

Work Item: AHR-1709 (https://plane.jimbui.dev/aiur/browse/AHR-1709/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Containerized Node service that generates thumbnail preview images for uploaded docs (PDFs + Word). Called post-upload for doc-type files; images use the AHR-1707 client-side utility instead. Thumbnail lands in R2; the `files` row's `thumbnail_r2_key` is updated. Revives the "Node + sharp thumbnail service" sketched in the `project_thumbnail_service_deferred` memory.

Tech: New `services/thumbnailer/` workspace package. Node 22 + Express + `sharp` (libvips prebuilt via npm) + `pdfjs-dist` + `canvas` (for pdfjs Node render) + LibreOffice headless for Word→PDF. Service endpoint `POST /thumbnail` authed via shared secret, invoked by a new Supabase Edge Function `files_r2_generate-thumbnail` that acts as frontend glue + access-verification layer. Deploy target **Fly.io** (per /p session decision — matches memory's container pattern, cheap, container-friendly). Local dev: 4th process in root `dev` script on `:8788`.

Related: AHR-1705 (`thumbnail_r2_key` column) is the write target. AHR-1707 (image utility) handles the image path client-side — this T2 covers everything else. AHR-1711 (upload flow) will invoke the edge fn once this T2's endpoint is live. Cloudflare Workers files bucket model (`cloudflare/workers/files/`) is the reference for R2 auth + env-per-bucket.

Siblings: 6 total, 1 Done (local, pending /pp) — AHR-1705 Schema (Done local), AHR-1707 Image utility (Todo, Not started — parallel), AHR-1711 Upload flow (Todo, Not started), AHR-1713 Strip component (Todo, Not started), AHR-1715 Wire strip (Todo, Not started)

Execution Order: Step 2 of 5 — prereq met (AHR-1705 locally Done). Runs in parallel with AHR-1707.

## Phase A: Service skeleton + container

- [x] Create `services/thumbnailer/` — `package.json` (name `@aiur-hr/thumbnailer`, `type: "module"`, Node 22 engines), `tsconfig.json`, `src/index.ts`
- [x] Add `services/*` to `pnpm-workspace.yaml` (after `cloudflare/workers/*`)
- [x] `Dockerfile` — `node:22-slim` base, `pnpm install --frozen-lockfile`, tsc build, CMD runs dist entry. sharp is npm-installed (ships libvips prebuilt for common archs)
- [x] Express app with `GET /healthz` → `{ ok: true }`, `POST /thumbnail` — full handler landed in Phase B (skipped the "501 stub" checkpoint; went straight to real)
- [x] Shared-secret auth middleware — compares `Authorization: Bearer ${SERVICE_AUTH_SECRET}` against env (inline in the handler, not middleware — same effect)
- [x] Env file `services/thumbnailer/.env.example`: `PORT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (matched edge-fn naming), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SERVICE_AUTH_SECRET`

## Phase B: PDF thumbnail rendering

- [x] **Deviation from plan:** dropped `pdfjs-dist` + `canvas` — the transitive `canvas` dep fails to install on Windows (needs Cairo/Pango native libs). Swapped to **`pdftoppm` (poppler-utils) via `spawn`** — same shell-out pattern we already use for LibreOffice. Zero Node native deps. Dockerfile installs `poppler-utils` + `libreoffice`.
- [x] `POST /thumbnail` body: `{ file_id: string }` — inline guard (no zod)
- [x] Read `files` row via Supabase service-role client → get `r2_key`, `content_type`
- [x] Download file from R2 via `GetObjectCommand` into a Buffer (handles both Node Readable + Web ReadableStream body shapes)
- [x] Branch on content_type: `application/pdf` → `pdftoppm -png -f 1 -l 1 -r 150` → first page PNG
- [x] Pipe PNG buffer into `sharp`: resize max 200×200 inside, format webp, quality 80 → output buffer
- [x] Upload thumbnail to R2 via `PutObjectCommand` at key `${r2_key}.thumb.webp`
- [x] PATCH `files` row: `thumbnail_r2_key = <new key>` via service-role client
- [x] Return `{ thumbnail_r2_key: <new key> }` on success; `{ thumbnail_r2_key: null, reason: string }` on recoverable failure (unsupported MIME, render failure, conversion failure)

## Phase C: Word (.docx) support — stretch

- [x] Add LibreOffice headless to Dockerfile (`apt-get install -y libreoffice` — no `--no-install-recommends` so the dep chain stays correct for `soffice --headless`)
- [x] Branch in `POST /thumbnail`: if content_type is `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, write buffer to temp file, run `soffice --headless --convert-to pdf --outdir <tmpdir>`, read the resulting PDF, fall through into the PDF path (25s timeout on soffice)
- [x] Temp-file cleanup in `finally` (recursive `rm`)
- [x] **Hard cutoff deferred to deploy-time**: cutoff thresholds (image > 1GB OR cold start > 30s on Fly `shared-cpu-1x 512MB`) can only be measured after `fly deploy`. If triggered, action is documented in README ("Hard cutoff for Word support"): revert `libreoffice` install, remove the `DOCX_MIME` branch, redeploy. Logged for follow-up.
- [x] Unsupported content_type: returns 200 `{ thumbnail_r2_key: null, reason: 'unsupported_content_type' }` — never 500

## Phase D: Supabase Edge Function glue

- [x] Created `frontend/vite/supabase/functions/files_r2_generate-thumbnail/` — `index.ts` + `deno.json`
- [x] Accept body `{ file_id: string }`, verify caller's JWT via `supabase.auth.getUser()`
- [x] Access check: `SELECT files.id WHERE id = {file_id}` via the user-scoped client (RLS); 403 if row not visible
- [x] Read `THUMBNAILER_URL` + `SERVICE_AUTH_SECRET` from env (to be set via `supabase secrets set` on deploy)
- [x] Forward to thumbnailer: `POST ${THUMBNAILER_URL}/thumbnail` with `{ file_id }` + `Authorization: Bearer ${SERVICE_AUTH_SECRET}`
- [x] Return thumbnailer's response to the client verbatim; preserves non-200 status codes so the hook can distinguish recoverable vs hard failures
- [x] CORS headers copied from `files_r2_upload-start` — consistent with the rest of the function boilerplate

## Phase E: Local dev + deploy

- [x] Root `package.json` `dev` script updated: `concurrently -n "EF,W,WEB,THUMB" -c "cyan,yellow,green,magenta"` + `dev:thumb` as `pnpm --filter @aiur-hr/thumbnailer dev`
- [x] `services/thumbnailer/package.json` `dev` script: `tsx watch src/index.ts`. `PORT` env defaults to 8788
- [x] **Windows dev caveat** (no plan item — arose during execution): native `pnpm dev` works because we swapped to `pdftoppm`/`soffice` via spawn; if those binaries aren't on the Windows dev machine, the service still boots but the `/thumbnail` endpoint returns 200 with `reason: "pdftoppm exit …"` / `reason: "soffice exit …"`. Windows dev can install Poppler for Windows + LibreOffice if they need local thumbnail testing; otherwise test via the Docker image or on staging
- [x] `services/thumbnailer/README.md` — full Fly.io deploy guide (fly launch / secrets list / fly deploy) + secret rotation runbook + hard-cutoff instructions
- [x] `fly.toml` template in the package (pre-filled with `shared-cpu-1x 512mb`, `auto_stop_machines`, concurrency limits)
- [x] Env matrix documented in README (local `http://localhost:8788`, staging `…-stag.fly.dev`, prod `…-prod.fly.dev`) + the `SERVICE_AUTH_SECRET` lockstep rotation procedure

## Phase F: Verify

- [x] `pnpm --filter @aiur-hr/thumbnailer type-check` passes cleanly (tsc --noEmit, no errors)
- [x] `pnpm --filter @aiur-hr/web type-check` still passes (three pre-existing unrelated errors only)
- [ ] **Deferred verification** (user-side, post-deploy): start `pnpm dev`, `curl /healthz`, then `curl POST /thumbnail` with a real PDF `file_id`. Can't be done from this session without the dev stack running + an actual PDF in R2 to target. AHR-1711 integration (upload flow calling the edge fn) will exercise this end-to-end.
- [ ] **Deferred verification** (Fly deploy): image size + cold start measurement for the hard-cutoff decision. Triggered when the service is first deployed to Fly.
- [ ] **Deferred** (`.docx` end-to-end test): same as above, post-deploy.

## Phase G: Architecture note

```
backend/
└── thumbnailer/              NEW (workspace pkg @aiur-hr/thumbnailer)
    ├── package.json          — deps: @aws-sdk/client-s3, @supabase/supabase-js, cors, express, jose, sharp
    ├── tsconfig.json         — NodeNext, ES2022, strict
    ├── Dockerfile            — multi-stage; runtime has poppler-utils + libreoffice
    ├── fly.toml              — Fly deploy template; shared-cpu-1x 512mb
    ├── .dockerignore
    ├── .env.example          — PORT / SUPABASE_* (URL/ANON/SERVICE_ROLE/JWT_SECRET) / R2_* / CORS_ALLOWED_ORIGINS
    ├── README.md             — flow diagram, endpoints, local dev, Fly deploy, cutoff, frontend integration
    └── src/
        └── index.ts          — Express app with /healthz + /thumbnail
                                - Supabase JWT verification via jose (HS256, SUPABASE_JWT_SECRET, audience=authenticated)
                                - user-scoped Supabase client for the files SELECT (RLS enforces access)
                                - service-role Supabase client only for the final files UPDATE
                                - CORS via `cors` middleware, origins from env
                                - R2 GetObject → pdftoppm (PDF) or soffice → pdftoppm (docx)
                                - sharp resize to webp
                                - R2 PutObject thumbnail at `${r2_key}.thumb.webp`
                                - UPDATE files.thumbnail_r2_key

pnpm-workspace.yaml           MODIFIED — 'backend/*' (replaced 'services/*')
package.json (root)           MODIFIED — `dev:thumb` script kept as standalone; NOT auto-started by default `pnpm dev`
```

**Architectural pivot (in-session after initial build)**: after reviewing Lightcraft's `spark/backend/whisperx/whisperx_service.py` pattern — one focused service per domain, FastAPI+Python for WhisperX because the library is Python-native, called directly from the browser with a Supabase JWT rather than via an edge-fn proxy — this T2 was reworked to match:

1. Folder moved `services/thumbnailer/` → `backend/thumbnailer/`; workspace glob updated.
2. **Auth swap**: the `SERVICE_AUTH_SECRET` shared-secret model is gone. The service now verifies Supabase JWTs directly (`jose.jwtVerify` with `SUPABASE_JWT_SECRET`). The extracted token builds a user-scoped Supabase client that does the RLS-gated files SELECT; only the final UPDATE of `thumbnail_r2_key` uses the service role.
3. **Edge function deleted**: `frontend/vite/supabase/functions/files_r2_generate-thumbnail/` is gone. The browser calls the service directly (same pattern as Lightcraft's whisperx call).
4. **CORS added**: since browsers now hit the service directly, `cors` middleware reads allowed origins from `CORS_ALLOWED_ORIGINS`.
5. **Dev script**: removed from the default `pnpm dev` concurrently list. Run `pnpm dev:thumb` in a separate terminal when working on file features.

**Deviations from original plan:**

1. **PDF renderer**: plan said `pdfjs-dist + canvas`; actual is `pdftoppm` via spawn. Canvas is unbuildable on Windows dev machines; pdftoppm is a Linux binary we install in the Docker runtime and devs can install natively (poppler/LibreOffice via brew/apt/Poppler-for-Windows) if they need local testing. Net: simpler Dockerfile, cross-platform dev, same output shape.
2. **Edge fn removed post-build**: originally planned, then deleted during the Lightcraft rework. Browser calls service directly.
3. **Hard cutoff for Phase C**: not tested in this session (no Fly deploy). Docker image size + cold start only measurable post-deploy. README documents the cutoff runbook so the decision can be made at that point.
4. **Phase F verification**: automatable portions (typechecks for both packages) are done. Runtime verification is deferred to when AHR-1711 (upload flow integration) exercises the full path, or when the service is first deployed to staging.

**What AHR-1711 inherits:**

- Frontend calls `fetch(\`${ENVs.ViteThumbnailerUrl}/thumbnail\`, { headers: { Authorization: \`Bearer ${accessToken}\` } })` directly — no `supabase.functions.invoke` middleman. Need to add `VITE_THUMBNAILER_URL` to the frontend ENVs schema.
- `files.thumbnail_r2_key` is populated by the service on success. The upload hook doesn't need to PATCH the row itself.
- The attachment strip (AHR-1713) reads `thumbnail_r2_key` and uses `useQ_Files_ReadUrl` to mint signed URLs for rendering — existing infra covers this.
- Treat `{ thumbnail_r2_key: null }` as "no preview, fall back to icon" — never fail the upload over it.

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)

Phase B: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)
- Task 7: (pending)
- Task 8: (pending)
- Task 9: (pending)

Phase C: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)

Phase D: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)
- Task 6: (pending)

Phase E: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)

Phase F: (pending)
- Task 1: (pending)
- Task 2: (pending)
- Task 3: (pending)
- Task 4: (pending)
- Task 5: (pending)

Phase G: (pending)
- Task 1: (pending)
