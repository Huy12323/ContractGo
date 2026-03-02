# WorldCraft

Monorepo project with React frontend, NestJS backend, and Supabase (local Docker).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TanStack Router, TanStack Query, TanStack Store, Ant Design |
| Backend | NestJS |
| Database | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Shared | `@worldcraft/shared` — TypeScript types generated from Supabase schema |
| Monorepo | pnpm workspaces + Turborepo |
| Deployment | Cloudflare Pages (frontend), container/VPS (backend) |

## Prerequisites

- **Node.js** 18+
- **pnpm** (`npm install -g pnpm`)
- **Docker Desktop** (must be running)
- **Supabase CLI** (`npm install -g supabase`)

## Setup (first time)

```bash
git clone <repo-url>
cd WorldCraft
pnpm install
supabase start
pnpm db:types                # generate TypeScript types from schema
```

Copy environment variables:

```bash
cp .env.example .env
```

Then fill `.env` with the keys printed by `supabase start` (anon key, service role key).

Create `apps/web/.env`:

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase start>
VITE_API_URL=http://localhost:3000
```

Create `apps/api/.env`:

```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>
API_PORT=3000
```

Start everything:

```bash
pnpm dev
```

## What You'll See

1. `supabase start` prints local URLs + keys (~30s first run to pull Docker images)
2. Frontend opens at **http://localhost:5173**
3. Login screen appears — click **Sign Up**, enter any email + password
4. Since email confirmation is disabled, you're logged in immediately
5. Dashboard shows your profile data fetched from Supabase
6. NestJS API runs at **http://localhost:3000** (health check: `GET /api/health`)

## Useful URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| NestJS API | http://localhost:3000 |
| Supabase Studio | http://localhost:54323 |
| Inbucket (email) | http://localhost:54324 |
| Supabase API | http://localhost:54321 |

## Project Structure

```
WorldCraft/
├── apps/
│   ├── web/                    # React SPA (TanStack Router + Ant Design)
│   │   └── src/
│   │       ├── routes/         # File-based routing
│   │       ├── components/     # UI components (max 2 levels deep)
│   │       ├── api/            # Supabase client + TanStack Query factories
│   │       ├── hooks/          # React hooks by domain
│   │       └── stores/         # TanStack Store (auth state)
│   └── api/                    # NestJS backend
│       └── src/
│           ├── common/         # Guards, decorators (Supabase auth)
│           └── modules/        # Feature modules (auth, profiles, health)
├── packages/
│   └── shared/                 # @worldcraft/shared
│       └── src/types/          # Supabase-generated TypeScript types
├── supabase/                   # Database schema, Edge Functions
│   ├── config.toml             # Local Supabase configuration
│   ├── migrations/             # SQL migrations (source of truth)
│   └── seed.sql                # Dev seed data
├── .claude/                    # PM Bible commands & skills
├── scripts/                    # Plane/Outline API utilities
└── docs/                       # PM workflow documentation
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start everything (Supabase + frontend + backend) |
| `pnpm dev:web` | Start frontend only |
| `pnpm dev:api` | Start NestJS only |
| `pnpm build` | Build all apps |
| `pnpm db:reset` | Drop and recreate database from migrations + seed |
| `pnpm db:types` | Regenerate TypeScript types from Supabase schema |
| `pnpm db:diff` | Generate migration from schema changes |
| `supabase start` | Start local Supabase (Docker) |
| `supabase stop` | Stop local Supabase |

## How Auth Works

- **Frontend** uses `@supabase/supabase-js` with the **anon key** (RLS enforced)
- **Backend** uses `@supabase/supabase-js` with the **service_role key** (bypasses RLS)
- Auth guard on NestJS validates the JWT from the `Authorization: Bearer <token>` header
- Profiles are auto-created via a Postgres trigger on user signup

## Database Migrations

**Always use migrations. Never make schema changes only in Studio.**

```bash
# After changing schema in Studio:
supabase db diff --use-migra -f my_change_name

# Verify migrations work from scratch:
pnpm db:reset

# Push to remote:
pnpm db:push
```

## PM Workflow (Bible)

This project uses the PM Bible for product management. Commands:

| Command | Role | Purpose |
|---------|------|---------|
| `/pm` | Manager | Vision, breakdown, triage |
| `/p` | Engineer | Plan implementation |
| `/s` | Engineer | Execute tasks |
| `/pp` | Engineer | Push to Plane + update Outline |
| `/rp` | Reporter | Cycle reports |
