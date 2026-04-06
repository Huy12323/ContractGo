# AIUR HR

Monorepo project with React frontend, Supabase backend, and Cloudflare (Pages + R2).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TanStack Router, TanStack Query, TanStack Store, Ant Design v6 |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions + Realtime) |
| File Storage | Cloudflare R2 (S3-compatible, zero egress) |
| Monorepo | pnpm workspaces |
| Deployment | Cloudflare Pages (frontend), Supabase Cloud (backend) |

## Prerequisites

- **Node.js** 18+
- **pnpm** (`npm install -g pnpm`)
- **Docker Desktop** (must be running)
- **Supabase CLI** (`npm install -g supabase`)

## Setup (first time)

```bash
git clone <repo-url>
cd aiur-hr
pnpm install
```

Apply environment variables:

```bash
cp .env.example .env.dev
# Fill in API keys
pnpm env:apply dev
```

Start everything:

```bash
pnpm dev
```

## Useful URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Supabase Studio | http://localhost:54323 |
| Supabase API | http://localhost:54321 |

## Project Structure

```
aiur-hr/
├── frontend/
│   └── vite/                   # React SPA (TanStack Router + Ant Design)
│       ├── supabase/           # Database + Edge Functions
│       │   ├── config.toml     # Local Supabase configuration
│       │   ├── migrations/     # SQL migrations (source of truth)
│       │   ├── functions/      # Supabase Edge Functions (Deno)
│       │   └── templates/      # Email templates
│       └── src/
│           ├── routes/         # File-based routing
│           ├── components/     # UI components (max 2 levels deep)
│           ├── configs/        # Supabase client config
│           ├── hooks/          # React hooks by domain
│           ├── stores/         # TanStack Store (auth state)
│           ├── types/          # Supabase-generated TypeScript types
│           └── utils/          # ENVs, query keys, options
├── .claude/                    # PM Bible commands & skills
├── scripts/                    # Plane/Outline API utilities
├── docs/                       # PM workflow documentation
└── cycles/                     # Plan files by cycle
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start everything (Supabase + Edge Functions + frontend) |
| `pnpm dev:web` | Start frontend only |
| `pnpm dev:ef` | Serve Edge Functions locally |
| `pnpm build` | Build frontend |
| `pnpm sb:dev:start` | Start local Supabase (Docker) |
| `pnpm sb:dev:stop` | Stop local Supabase |
| `pnpm sb:dev:reset` | Drop and recreate database from migrations + seed |
| `pnpm sb:dev:types` | Regenerate TypeScript types from Supabase schema |
| `pnpm sb:dev:diff` | Generate migration from schema changes |
| `pnpm sb:dev:push` | Apply pending migrations locally |
| `pnpm sb:dev:new` | Create new empty migration |
| `pnpm env:apply dev` | Distribute env vars to destinations |

## How Auth Works

- Frontend uses `@supabase/supabase-js` with the **anon key** (RLS enforced)
- Edge Functions use the **service_role key** when they need to bypass RLS
- Profiles are auto-created via a Postgres trigger on user signup

## Database Migrations

**Always use migrations. Never make schema changes only in Studio.**

```bash
# After changing schema in Studio:
pnpm sb:dev:diff -- -f my_change_name

# Apply migrations (preserves data):
pnpm sb:dev:push

# Regenerate types:
pnpm sb:dev:types
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
