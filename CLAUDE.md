# AIUR HR

## Tech Stack

- **Frontend:** React 19, TanStack Router (file-based), TanStack Query v5, TanStack Store, Ant Design v6
- **Backend:** Supabase (PostgreSQL + Auth + Edge Functions + Realtime)
- **File Storage:** Cloudflare R2 (S3-compatible)
- **Monorepo:** pnpm workspaces
- **Deployment:** Cloudflare Pages (web), Supabase Cloud (backend)

## Conventions

- **Supabase types** live in `frontend/vite/src/types/`. Regenerate with `pnpm sb:dev:types`.
- **Migrations** are the source of truth for schema. Never modify schema only through Studio.
- **Frontend components** are max 2 levels deep: `components/[domain]/[Component].tsx`.
- **Edge Functions** live in `frontend/vite/supabase/functions/[name]/index.ts` (Deno runtime).
- **Auth:** Frontend uses anon key (RLS enforced). Edge Functions use service_role key when needed.
- **Environment:** `.env` files per app. Never commit `.env` files.

## PM Workflow

This project uses the PM Bible. See `docs/pm.md` for the full workflow.
Commands: `/pm`, `/p`, `/s`, `/pp`, `/rp`, `/triage`, `/gitpush`, `/bible-sync`, `/load-skills`.
