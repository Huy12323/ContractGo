# Deployment Guide

End-to-end guide for deploying AIUR HR to production (self-hosted Supabase on Hetzner + Cloudflare R2 Worker).

---

## What gets deployed where

| Component | Target | Mechanism |
|---|---|---|
| Database schema (migrations) | Self-hosted Postgres via Supavisor pooler | `supabase db push --db-url <pooler-url>` over TLS |
| Edge functions | `supabase/edge-runtime` container's bind-mounted volume on VPS | `tar` + `ssh` (no CLI equivalent for self-hosted) |
| Vite frontend | Cloudflare Pages | Auto-deploy from git push (separate flow) |
| R2 Worker (file serving) | Cloudflare Workers | `pnpm w:production:deploy` (Wrangler) |
| Server env vars (SMTP, R2 creds for edge fns, auth redirects) | `/supabases/aiur--hr/.env` + `docker-compose.yml` on VPS | Manual — infra change, not per-release |

This guide covers the first two (migrations + edge functions) — that's what `pnpm sb:production:deploy` does. The Worker deploy is a separate step.

---

## Prerequisites

1. **Node 18+** and **pnpm** (see `package.json` for the pinned pnpm version).
2. **Supabase CLI** — `scoop install supabase` on Windows, `brew install supabase/tap/supabase` on macOS, or [download](https://github.com/supabase/cli#install-the-cli).
3. **`tar`** — ships with Git Bash, WSL, macOS, and Linux. Windows 10+ has it in `System32`. On plain Windows CMD, prefer running deploys from Git Bash.
4. **SSH access to the production server** — ask Jim. Your key needs to be added to `~root/.ssh/authorized_keys` on the VPS (currently only Jim has access). See [SSH access](#ssh-access) below.
5. **`.env.prod`** at the repo root — Jim provides the secrets. See [.env.prod](#envprod-configuration) below.

---

## SSH access

The deploy script uploads edge functions via `tar` piped into an `ssh` session. Two ways your machine authenticates:

### Option A — SSH config alias (recommended if you'll deploy often)

Add to `~/.ssh/config`:

```
Host aiurhr
    HostName 5.78.184.149
    User root
    IdentityFile ~/.ssh/your_deploy_key
```

Then set in `.env.prod`:
```
DEPLOY_SSH_TARGET=aiurhr
DEPLOY_SSH_OPTS=
```

### Option B — Raw target + explicit key

Skip the SSH config file, point at the server directly:

```
DEPLOY_SSH_TARGET=root@5.78.184.149
DEPLOY_SSH_OPTS=-i ~/.ssh/your_deploy_key
```

Both work. The script concatenates them as `ssh $DEPLOY_SSH_OPTS $DEPLOY_SSH_TARGET`.

### Verify access

```bash
ssh $DEPLOY_SSH_TARGET "ls /supabases/aiur--hr/volumes/functions | head"
```

Should list the existing functions. If you get "permission denied", your key isn't authorized yet — ask Jim.

---

## `.env.prod` configuration

Copy `.env.example` → `.env.prod` at the repo root and fill in. **Never commit `.env.prod`** — it's gitignored.

The deploy script reads these fields specifically:

| Variable | Purpose | Example |
|---|---|---|
| `SUPABASE_DB_URL` | Supavisor session-pool connection string used by `supabase db push` | `postgresql://postgres.aiur--hr:<pw>@aiur--hr-db.aiursoftware.com:10002/postgres` |
| `DEPLOY_SSH_TARGET` | SSH destination (alias or `user@host`) | `aiurhr` or `root@5.78.184.149` |
| `DEPLOY_SSH_OPTS` | Optional extra ssh flags | `-i ~/.ssh/key -p 22` (or blank) |
| `DEPLOY_REMOTE_FUNCTIONS_PATH` | Absolute path on server to functions volume | `/supabases/aiur--hr/volumes/functions` |

Other sections (`[VITE]`, `[SUPABASE_FUNCTIONS]`, `[WORKER_FILE_STORAGE]`, `[MCP]`) are distributed by `pnpm env:apply:prod` — not read by the deploy script directly. Run `pnpm env:apply:prod` once whenever `.env.prod` changes, so the sub-folder `.env` files stay in sync.

---

## Running a deploy

```bash
# 1. One-time per checkout, or after .env.prod changes
pnpm env:apply:prod

# 2. Deploy
pnpm sb:production:deploy
```

What step 2 does:

1. **Migrations** — runs `supabase db push --db-url "$SUPABASE_DB_URL" --debug`. The `--debug` flag is required because Supavisor doesn't terminate TLS, and the CLI's pgx driver only falls back to plaintext when debug logging is enabled (upstream CLI bug). Every file in `frontend/vite/supabase/migrations/` not already present in `supabase_migrations.schema_migrations` on the server will be applied in filename order.
2. **Edge functions** — tars `frontend/vite/supabase/functions/` (excluding `main/` and any `.env` files), pipes over SSH to the server, extracts into `$DEPLOY_REMOTE_FUNCTIONS_PATH`. Deno hot-picks the new code on the next invocation; no container restart needed.

Roughly 30–90 seconds end-to-end.

### What `main/` is and why we don't touch it

The `main/` folder on the server contains the Deno **router** — receives every `/functions/v1/*` request from Kong, inspects the URL path, and spawns a worker for the matching function folder (`/home/deno/functions/<name>/index.ts`). It's maintained server-side (it's part of the self-hosted Supabase template, not our application code). The local repo doesn't have a `main/` folder, and the deploy script excludes it from upload as defense in depth.

---

## Adding a new edge function

1. Create the folder: `frontend/vite/supabase/functions/<name>/index.ts`
2. Write the function (standard Deno `Deno.serve` handler).
3. Run `pnpm sb:production:deploy` — the tar upload picks up new folders automatically.
4. Invoke: `https://aiurhr-sb.aiursoftware.com/functions/v1/<name>` with an `apikey` header (anon or service role).

The JWT verification default is `FUNCTIONS_VERIFY_JWT=false` on the server — if you want to enforce JWT on a specific function, check the token inside the function body.

---

## Adding a new edge-function env var (self-hosted quirk)

On Supabase Cloud, `supabase secrets set X=...` pushes secrets to functions. **That command does not work for self-hosted.** Here's the two-step process:

1. **On the server**, add the var to `/supabases/aiur--hr/.env` AND to the `functions.environment:` block in `/supabases/aiur--hr/docker-compose.yml`. The compose `environment:` block must reference the var (`MY_NEW_KEY: ${MY_NEW_KEY}`) — it doesn't auto-propagate from `.env`.
2. **Restart**: `cd /supabases/aiur--hr && docker compose up -d functions`.

Then reference it from Deno as `Deno.env.get("MY_NEW_KEY")`.

For consistency, also add the var to the `[SUPABASE_FUNCTIONS]` section of `.env.example` and `.env.prod` so it's documented for future devs — even though the root `.env.prod` isn't what the server reads.

---

## Architecture reference

The production VPS runs a single docker-compose stack at `/supabases/aiur--hr/`:

| Service | Image | Role |
|---|---|---|
| `db` | `supabase/postgres:17.6.1.110` | Postgres + pgsodium + pg_cron extensions |
| `supavisor` | `supabase/supavisor:2.7.4` | Connection pooler — session mode on :10002, txn mode on :10003 |
| `kong` | `kong:2.8.1` | API gateway — routes `/rest/*`, `/auth/*`, `/functions/*`, etc. |
| `auth` | `supabase/gotrue:v2.186.0` | User auth, SMTP email, password reset |
| `rest` | `postgrest/postgrest:v14.5` | Auto-generated REST API from the public schema |
| `realtime` | `supabase/realtime:v2.76.5` | WebSocket subscriptions |
| `functions` | `supabase/edge-runtime:v1.70.3` | Deno runtime that runs our edge functions |
| `storage` | `supabase/storage-api:v1.48.26` | Provides the `storage.buckets`/`storage.objects` schema — **actual file bytes are in R2**, this container mainly owns the metadata tables |

Not running (excluded for footprint / not needed):
- `studio` — Supabase dashboard. Stays behind a compose profile; start with `docker compose --profile studio up -d` if you need to inspect data. URL: `https://aiurhr-studio-sb.aiursoftware.com`.
- `meta`, `imgproxy`, `analytics`, `vector` — excluded from this deployment.

### External endpoints

| URL | Routes to | DNS |
|---|---|---|
| `https://aiurhr-sb.aiursoftware.com` | Caddy → `localhost:10000` (Kong) | Proxied (orange) |
| `aiur--hr-db.aiursoftware.com:10002` | Direct TCP → Supavisor session pool | DNS-only (grey). Firewall: TCP 10002/10003 open. |
| `https://aiur-hr-files.aiursoftware.com` | Cloudflare Worker (R2 file serving) | Routed via Worker |
| `https://hr.aiursoftware.com` | Vite frontend (Cloudflare Pages) | Separate deploy flow |

### Where secrets live on the server

- `/supabases/aiur--hr/.env` — all env vars referenced by `docker-compose.yml`. Owned by root.
- Container envs are read at `docker compose up`, so changes require restarting the affected service: `docker compose up -d <service>`.

---

## Troubleshooting

### `relation "storage.buckets" does not exist`

The `storage` service isn't running or its migrations never ran. Start it: `docker compose up -d storage`. On first boot, storage-api creates `storage.buckets`, `storage.objects`, etc. Then re-run `pnpm sb:production:deploy`.

### `unknown flag: --db-url` during functions deploy

You're running an older version of `scripts/sb-remote-push.js` that calls `supabase functions deploy --db-url` (which doesn't exist for self-hosted). Pull latest — the script now uses tar-over-ssh.

### `configuration file "/etc/postgresql/postgresql.conf" contains errors`

The `db-config` docker volume has a postgresql.conf from a different PG major version. Wipe and reinit:
```bash
ssh $DEPLOY_SSH_TARGET "cd /supabases/aiur--hr && docker compose down -v && rm -rf volumes/db/data volumes/db/pgsodium && docker compose up -d"
```
⚠️ This destroys all DB data — only safe on an empty/unused instance.

### `Permission denied (publickey)` on deploy

Your SSH key isn't authorized on the server. Ask Jim to add it, or test first with `ssh $DEPLOY_SSH_TARGET echo ok`.

### Migration succeeds but the change doesn't appear in the app

The app likely caches types from `src/types/database.types.ts`. Regenerate after a schema change:
```bash
pnpm sb:dev:types    # generates from local DB — run after sb:dev:push
```

### Edge function returns old code after deploy

Deno lazy-spawns workers per request and should pick up new code immediately. If it doesn't (stale module cache), force it:
```bash
ssh $DEPLOY_SSH_TARGET "cd /supabases/aiur--hr && docker compose restart functions"
```

### `supabase db push` hangs or fails TLS handshake

Supavisor uses a TLS termination model that the pgx driver handles oddly. The `--debug` flag in the script works around this — if you're invoking `supabase db push` manually, include `--debug`.

---

## Related docs

- `docs/pm.md` — project management workflow (Plane + Outline)
- `docs/index.md` — documentation index
- `.env.example` — full env var reference with per-section comments
