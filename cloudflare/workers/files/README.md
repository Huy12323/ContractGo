# ContractGo Files Worker

Cloudflare Worker serving files from R2 with JWT authentication.

Current state is a **bootstrap stub** (AHR-802). Auth-gated serving logic — JWT verification, `orgs/` vs `users/` rule-sets, MIME-based cache strategy, CORS preflight — lands in AHR-805.

## R2 buckets

| Environment | Bucket         |
| ----------- | -------------- |
| Development | `aiurhr--dev`  |
| Staging     | `aiurhr--stag` |
| Production  | `aiurhr--prod` |

Bound to `env.FILES_BUCKET` per environment via `wrangler.toml`.

## Local dev

Runs as part of the root 3-process dev script:

```bash
pnpm dev    # EF + W + WEB — Worker boots on http://localhost:8787
```

Or standalone:

```bash
cd cloudflare/workers/files
pnpm dev
```

Note: the root `dev:w` script wraps `wrangler dev` with `scripts/wrangler-auto-restart.js`, which restarts the Worker every 15 minutes to dodge [Miniflare's R2-binding degradation](https://github.com/cloudflare/workers-sdk/issues) after ~1 hour.

## Deploy

```bash
# From repo root
pnpm w:staging:deploy
pnpm w:production:deploy

# Or from this directory
cd cloudflare/workers/files
pnpm deploy:staging
pnpm deploy:production
```

## Setup checklist (per environment)

1. **Secrets** — set before first deploy. `WORKER_JWT_SECRET` is shared with the `files_r2_sign-read-url` Supabase Edge Function (it mints; the Worker verifies). Set on both sides in lockstep:

    ```bash
    # Worker side
    wrangler secret put WORKER_JWT_SECRET --env staging
    wrangler secret put WORKER_JWT_SECRET --env production
    ```

    ```
    Supabase Dashboard → Project Settings → Edge Functions → Secrets →
    add WORKER_JWT_SECRET with the same value (staging and production projects).
    ```

    Rotate by updating both sides in the same window — mismatched values cause blanket 401s from the Worker.

2. **R2 bucket CORS** — presigned PUT uploads hit R2 directly (bypassing the Worker), so R2 needs bucket-level CORS.
    - Copy `r2-cors.example.json` → `r2-cors.dev.json` / `r2-cors.stag.json` / `r2-cors.prod.json`
    - Fill in real origins
    - Apply (run from `cloudflare/workers/files/`):
        ```bash
        wrangler r2 bucket cors set aiurhr--dev  --file r2-cors.dev.json
        wrangler r2 bucket cors set aiurhr--stag --file r2-cors.stag.json
        wrangler r2 bucket cors set aiurhr--prod --file r2-cors.prod.json
        ```
    - Copies with real origins are gitignored (only `.example.json` is committed)

3. **Custom domain** — Cloudflare Dashboard → Workers & Pages → `aiur-hr-files-<env>` → Settings → Triggers → Add Custom Domain. DNS records are configured automatically once the domain is added.

4. **FE env** — set `VITE_R2_WORKER_URL` in the corresponding env file (`.env.stag`, `.env.prod`) to the custom-domain URL, then run `pnpm env:apply:<env>`.

## Logs

```bash
cd cloudflare/workers/files
pnpm tail                            # default (dev)
wrangler tail --env staging
wrangler tail --env production
```
