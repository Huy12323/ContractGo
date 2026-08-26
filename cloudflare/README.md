# ContractGo — Cloudflare Infrastructure

Cloudflare Workers and R2 storage configuration for ContractGo.

## Overview

- **R2** — S3-compatible object storage (zero egress) for uploaded files (contracts, employee dynamic-column files, user avatars)
- **Workers** — edge compute for JWT-authenticated file serving with CDN caching

## Architecture

```
Upload:   Browser → Supabase Edge Fn (auth + presigned PUT URL) → R2 (direct)
Download: Browser → Worker (JWT verify + R2 fetch + cache) → Browser
```

## ⚠️ Temporary: local storage stand-in

Until a Cloudflare account is available, the `files_r2_*` edge functions can store
objects in a **Supabase Storage** bucket instead of R2. The switch is one env var —
`STORAGE_DRIVER` in the `[SUPABASE_FUNCTIONS]` section of `.env.<env>`:

| Value          | Backend                                          | Requires                                             |
| -------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `r2` (default) | R2 presigned PUT + this Worker for reads         | R2 credentials, `CLOUDFLARE_API_TOKEN`, `pnpm dev:w` |
| `local`        | Supabase Storage bucket (`STORAGE_LOCAL_BUCKET`) | nothing beyond the local Supabase stack              |

All R2 logic lives untouched behind the `r2` branch of
`frontend/vite/supabase/functions/_shared/storage.ts`; the three edge functions and
the entire frontend are driver-agnostic. Object keys (`files.r2_key`) are byte-identical
under both drivers, so existing rows stay valid across a swap.

**Swapping R2 back in:**

1. Fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
   `R2_WORKER_URL`, `WORKER_JWT_SECRET`, `CLOUDFLARE_API_TOKEN` in `.env.<env>`.
2. Set `STORAGE_DRIVER=r2`.
3. `pnpm env:apply:dev` and restart `pnpm dev:ef` (plus `pnpm dev:w` for the Worker).
4. Copy any bytes written while on `local` out of the Supabase `files` bucket into R2
   at the same keys — DB rows need no change.

## Directory

```
cloudflare/
└── workers/
    └── files/              # Files Worker (bootstrap in AHR-802; serving logic in AHR-805)
        ├── src/
        │   └── index.js
        ├── wrangler.toml
        ├── package.json
        ├── r2-cors.example.json
        └── README.md
```

## Account

- **Cloudflare account:** `Jimbui@aiursoftware.com's Account`
- **Account ID:** `156c6587f5eeeef516ea33aba5b50fb2`

## R2 Buckets

| Environment | Bucket         |
| ----------- | -------------- |
| Development | `aiurhr--dev`  |
| Staging     | `aiurhr--stag` |
| Production  | `aiurhr--prod` |

Buckets are created on the Jimbui account (as of 2026-04-16).

## Prerequisites (one-time per machine)

1. **Install Wrangler** (comes as a devDep of `cloudflare/workers/files` — available via `pnpm --filter contractgo-files-worker exec wrangler` or by running root `pnpm dev:w`)
2. **Authenticate:**
    ```bash
    wrangler login
    ```
3. **Select the correct account** if multiple are available — wrangler.toml pins `account_id`, but shell-level `CLOUDFLARE_ACCOUNT_ID` takes precedence

## Common operations

### Local dev (3-process: Supabase EF + Worker + Vite)

```bash
pnpm dev
```

The `W` column runs `node scripts/wrangler-auto-restart.js` — wrangler dev with automatic 15-min restart to dodge the Miniflare R2-binding degradation issue.

### Deploy

```bash
pnpm w:staging:deploy       # deploys to aiur-hr-files-staging
pnpm w:production:deploy    # deploys to aiur-hr-files-prod
```

### Worker secrets

```bash
cd cloudflare/workers/files
wrangler secret put WORKER_JWT_SECRET --env staging
wrangler secret put WORKER_JWT_SECRET --env production
```

### R2 bucket CORS (when origins are decided)

Copy `r2-cors.example.json` → `r2-cors.dev.json` (or per env), fill in real origins, then:

```bash
wrangler r2 bucket cors put aiurhr--dev  --file cloudflare/workers/files/r2-cors.dev.json
wrangler r2 bucket cors put aiurhr--stag --file cloudflare/workers/files/r2-cors.stag.json
wrangler r2 bucket cors put aiurhr--prod --file cloudflare/workers/files/r2-cors.prod.json
```

## Outstanding setup

| Item                       | Status | Who / when                     |
| -------------------------- | ------ | ------------------------------ |
| R2 enabled on account      | ✓ Done | 2026-04-16                     |
| Buckets created            | ✓ Done | 2026-04-16                     |
| CORS origin list           | TODO   | When staging/prod URLs are set |
| Custom domains (DNS)       | TODO   | Post-deploy                    |
| `WORKER_JWT_SECRET` values | TODO   | AHR-805 (Worker auth + JWT)    |
