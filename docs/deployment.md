# Deployment Guide

End-to-end guide for deploying ContractGo to production (self-hosted Supabase on Hetzner + Cloudflare R2 Worker).

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

## Email delivery (Resend)

All outbound mail goes through one edge function, `shared--send-email`. Nothing else talks to a mail provider — `auth_send-verification`, `organizations_send-invitation` and every envelope notification in `_shared/envelopeNotify.ts` call it over HTTP with the service-role key.

Set these on the server, via the two-step process above (server `.env` **and** the `functions.environment:` block, then `docker compose up -d functions`):

| Var | Production value |
|---|---|
| `EMAIL_DRIVER` | `resend` |
| `RESEND_API_KEY` | From Resend → API Keys → Create, *Sending access* |
| `RESEND_SENDER_EMAIL` | An address on a **verified sending domain** |
| `RESEND_SENDER_NAME` | `ContractGo` |
| `OTP_DRIVER` | Leave unset (defaults to `email`) |

**`OTP_DRIVER=mock` must never be set on a deployed server**, and unlike the other three signing drivers this one is safe to leave unset — it defaults to `email` for exactly that reason (CG-031). The mock logs the passcode to the server and reports success, so a production stack running it would tell every recipient of an `email_otp` envelope that a code had been sent, send none, and then refuse their signature. It reuses `shared--send-email`, so it needs no configuration of its own beyond the mail settings above.

**`EMAIL_ALLOWLIST` must be empty in staging and production.** It is a comma-separated list of the only recipients that get real mail; anyone else is logged to the console and the caller receives `200 {"status":"filtered"}` instead of a delivery failure. It exists so a dev stack on the `resend.dev` test sender can still run signup and invitations end to end. Empty means no filtering — a stale allowlist on a real deployment would silently drop mail to actual users, so it is opt-in only.

**`onboarding@resend.dev` is not viable in production.** It is Resend's shared test sender: it skips domain verification, but only delivers to the address that owns the Resend account, and 403s every other recipient. `shared--send-email` returns that as a 502, which `auth_send-verification` and `organizations_send-invitation` treat as a hard failure — so signup confirmation and invitations would break for every real user. Verify a domain before going live.

**`DEV_SIGNING_LINKS` must never be set on a deployed server.** It unlocks `envelopes_dev-signing-link`, which hands a recipient's signing link to the *sender*. That link is a bearer credential that speaks as the signer, so setting it lets a sender sign on a counterparty's behalf and hollows out the audit trail. It is absent-by-default and ships commented out in `.env.example`; keep it that way outside a developer machine. The same applies to `EMAIL_DRIVER=console`, whose log line contains the signing link verbatim.

---

## AI document assistant (CG-049)

The reading assistant beside the contract on the signing surface. One edge function, `signing_ai_ask`, is the only thing that talks to a model; the driver seam is `_shared/ai.ts` and mirrors the signing and storage seams.

Set these on the server via the two-step process above (server `.env` **and** the `functions.environment:` block, then `docker compose up -d functions`):

| Var | Production value |
|---|---|
| `AI_DRIVER` | `gemini`, or `off` to disable the feature entirely |
| `GEMINI_API_KEY` | From <https://aistudio.google.com/apikey> |
| `GEMINI_MODEL` | Leave unset (defaults to `gemini-3.6-flash`) |

**The free tier's request-per-day allowance is a *project* resource, not a per-user one.** That is the fact that shapes the whole feature's operations story. A signing link is a bearer credential that gets forwarded and scanned, so a public endpoint holding an LLM key is a free-proxy risk — and unlike every other public signing function, abuse here spends something *every tenant's signers draw on*. Per-credential throttling alone cannot protect it.

So there are six caps, and **they live in SQL, inside `signer_ai_message_begin`** (see the CG-049 migration): 5-second cooldown, 15/hour and 30/lifetime per signing link, 120 per envelope, 500 per organization per day, and a **deployment-wide daily cap set to roughly 60% of the real upstream RPD**. Changing any of them takes a migration, deliberately — a limit you can change without one is a limit nobody reviews. If you switch to a model with a different RPD, **update the deployment-wide cap to match**; leaving it high turns an upstream 429 into a mid-ceremony failure, which is precisely what the headroom exists to prevent.

**Turning it off.** Two switches, at two scopes, and they are not interchangeable:

- `AI_DRIVER=off` — deployment-wide. The endpoint 503s before it touches the database and `signing_session_open` stops advertising the panel.
- `UPDATE public.organizations SET ai_assistant_enabled = false WHERE id = '…'` — one tenant, no deploy. Default is `true`.

**The transcript is not sender-visible, and that is a product decision rather than a missing feature.** `signer_ai_messages` has RLS on with zero policies and no view, no RPC and no certificate line reads it. A signer's questions are their own words about why they hesitate, and the Certificate of Completion goes to the counterparty. The audit chain gets exactly one `signer_ai_question_asked` entry per signing link, with no question and no answer text. Do not add a policy "so support can see it" without reading PHASE 7 of the migration first.

**Scanned contracts get no assistant.** `unpdf` extracts a text layer; a scan has none, so the extraction is recorded as `insufficient_text` and the panel stops appearing for that envelope. This is intended — an ungrounded model guessing at a contract it cannot read is the worst outcome available here.

---

## Enabling Google sign-in (CG-028)

`frontend/vite/supabase/config.toml` configures the **local** CLI stack only. Production runs self-hosted GoTrue, which reads its provider config from the server env — so shipping the code does not turn the feature on in production. Three steps:

**1. Google Cloud Console** — one OAuth 2.0 *Web application* client serves both environments. Under **Authorized redirect URIs**, list GoTrue's own callback (not the app's):

```
http://localhost:54321/auth/v1/callback              # local CLI stack
https://aiurhr-sb.aiursoftware.com/auth/v1/callback  # production Kong → auth
```

**2. On the server**, add to `/supabases/aiur--hr/.env` and make sure `docker-compose.yml`'s `auth.environment:` block references each one (same quirk as edge-function vars above — `.env` does not auto-propagate):

```
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<client id>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<client secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://aiurhr-sb.aiursoftware.com/auth/v1/callback
GOTRUE_URI_ALLOW_LIST=https://hr.aiursoftware.com/**
```

`GOTRUE_URI_ALLOW_LIST` is the production equivalent of `additional_redirect_urls` and **must** cover `https://hr.aiursoftware.com/auth/callback`. If it doesn't, GoTrue drops the app's `redirect_to` and sends the user to `SITE_URL` instead — the flow appears to work but always lands on `/`.

**3. Restart**: `cd /supabases/aiur--hr && docker compose up -d auth`.

Nothing is needed on the Cloudflare Pages side: the client id is never exposed to the browser, so there is no new `VITE_` var.

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
