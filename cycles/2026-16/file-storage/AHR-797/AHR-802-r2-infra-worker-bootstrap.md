# R2 infra + Worker bootstrap

Work Item: AHR-802 (https://plane.jimbui.dev/aiur/browse/AHR-802/)
Tier 1: AHR-797 [v0.0.1 | File Storage] R2 migration + 3-bucket setup + Worker serving (Todo)
Module: File Storage (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034
Version Doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d

## Context (from spec)

Non-tech: File storage is migrating from Supabase Storage to Cloudflare R2 + Workers for zero egress, hard per-env isolation, and a single system that also holds user-level files (avatars). This T2 lays the infra foundation — R2 buckets are already created on the Jimbui account, and this ships the Worker package + root dev orchestration so later T2s (presigned PUT edge fn, Worker serving, FE upload hook) have a working scaffold.
Tech: New `cloudflare/workers/files/` package with `wrangler.toml` (3 env configs, `FILES_BUCKET` binding → `aiurhr--{dev,stag,prod}`, account_id `156c6587f5eeeef516ea33aba5b50fb2`). `src/index.ts` is a minimal stub — real auth-gated serving lands in AHR-805. `scripts/wrangler-auto-restart.js` ported from lightcraft dodges the 1h Miniflare R2-binding degradation. Root `pnpm dev` becomes a 3-process `concurrently` run (EF + Worker + Vite). `ViteR2WorkerUrl` added to `ENVs.ts`. `pnpm-workspace.yaml` picks up `cloudflare/workers/*`.
Related: none yet — foundation for AHR-803 (files table + RLS, parallel step 1), AHR-804 (presigned PUT edge fn, step 2), AHR-805 (Worker auth-gated serving, step 2), AHR-806–808 (downstream).
Siblings: 7 total, 0 Done — AHR-802 (this, planning now), AHR-803 files table + RLS (Todo, not started), AHR-804 presigned PUT edge fn (Todo, not started), AHR-805 Worker auth + JWT (Todo, not started), AHR-806 FE upload hook (Todo, not started), AHR-807 contract signing migrated (Todo, not started), AHR-808 decommission Supabase Storage (Todo, not started)
Execution Order: Step 1 of 5 — parallel with AHR-803 (both foundation); no prerequisites, green to proceed

## Phase A: Worker package + wrangler scaffolding

- [x] Add `cloudflare/workers/*` to `pnpm-workspace.yaml`
- [x] Create `cloudflare/README.md` — infra overview, manual setup checklist (enable R2 ✓ done, `wrangler login` ✓ done, buckets ✓ created, remaining TODOs: CORS origins, custom domains)
- [x] Create `cloudflare/workers/files/wrangler.toml` — `main = "src/index.js"` (went with JS for the stub to avoid `@cloudflare/workers-types` dep until AHR-805), `account_id = "156c6587f5eeeef516ea33aba5b50fb2"`, `compatibility_date = "2026-04-16"`, `nodejs_compat` flag; 3 env configs each binding `FILES_BUCKET` → `aiurhr--{dev,stag,prod}`; secrets + custom-domain comments inline
- [x] Create `cloudflare/workers/files/package.json` — name `aiur-hr-files-worker`, `type: "module"`, scripts: `dev` / `deploy` / `deploy:staging` / `deploy:production` / `tail` / `clean`; devDeps: `wrangler@^4.83`, `rimraf@^6`
- [x] Create `cloudflare/workers/files/src/index.js` — minimal stub returning `AHR files worker — bootstrap (<env>)`; header comment flags AHR-805 as the replacement
- [x] Create `cloudflare/workers/files/README.md` — setup checklist (secrets, CORS per-env, custom domain, FE env), dev + deploy commands, log tailing
- [x] Create `cloudflare/workers/files/r2-cors.example.json` — 3 origins (localhost + 2 TODO placeholders), PUT/GET/HEAD methods, standard headers
- [x] Run `pnpm install` — worker workspace linked, `wrangler`/`rimraf`/`workerd` installed (+38 packages)

## Phase B: wrangler-auto-restart + root dev orchestration

- [x] Port `scripts/wrangler-auto-restart.js` from lightcraft — `WORKER_DIR` → `../cloudflare/workers/files`, dotenv require dropped (unused — wrangler.toml carries `account_id`); comment block updated to reflect AHR layout
- [x] Update root `package.json`: added `"dev:w": "node scripts/wrangler-auto-restart.js"`; changed `"dev"` to 3-process `concurrently -n "EF,W,WEB" -c "cyan,yellow,green" ...`
- [x] Added `"w:staging:deploy"` and `"w:production:deploy"` scripts to root `package.json`
- [x] Confirmed `concurrently` already root devDep (`^9.1.2`)

## Phase C: FE env wiring

- [x] Added `ViteR2WorkerUrl: str` to `frontend/vite/src/utils/ENVs/ENVs.ts` schema
- [x] Added `VITE_R2_WORKER_URL=http://localhost:8787` under `[VITE]` in `.env.dev`
- [x] Added `VITE_R2_WORKER_URL=` placeholder to `.env.example` with inline comment (dev vs staging/prod note). Note: `.env.stag` / `.env.prod` don't exist yet — the `.env.example` template serves as the source when those env files are created; README doc'd this under "FE env" step
- [x] Ran `pnpm env:apply:dev` → `frontend/vite/.env` regenerated with the new var (verified by reading the file)

## Phase D: Smoke verification

- [x] Run `pnpm dev` → three labeled processes started (`EF`, `W`, `WEB`); Wrangler printed a local URL
- [x] `curl http://localhost:8787/` → confirmed `200 OK` with the bootstrap stub response
- [x] `ENVs.ViteR2WorkerUrl` accessible from FE — Vite booted without jet-env error
- [x] Graceful shutdown — `Ctrl+C` tore down all 3 children cleanly, no orphan wrangler process

---

## Plane IDs (populated by /pp)

Phase A: AHR-817
- Task 1 (pnpm-workspace.yaml): AHR-818
- Task 2 (cloudflare/README.md): AHR-819
- Task 3 (wrangler.toml): AHR-820
- Task 4 (worker package.json): AHR-821
- Task 5 (src/index.js stub): AHR-822
- Task 6 (worker README.md): AHR-823
- Task 7 (r2-cors.example.json): AHR-824
- Task 8 (pnpm install): AHR-825

Phase B: AHR-826
- Task 1 (wrangler-auto-restart.js): AHR-827
- Task 2 (root 3-process dev + dev:w): AHR-828
- Task 3 (w:staging:deploy / w:production:deploy): AHR-829
- Task 4 (concurrently already root devDep): AHR-830

Phase C: AHR-831
- Task 1 (ENVs.ts schema): AHR-833
- Task 2 (.env.dev [VITE]): AHR-834
- Task 3 (.env.example doc): AHR-835
- Task 4 (env:apply:dev): AHR-836

Phase D: AHR-832
- Task 1 (pnpm dev 3 streams): AHR-837
- Task 2 (curl stub 200): AHR-838
- Task 3 (Vite boots via ENVs): AHR-839
- Task 4 (graceful shutdown): AHR-840
