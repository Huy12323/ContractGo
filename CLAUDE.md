# WorldCraft

## Tech Stack

- **Frontend:** React 19, TanStack Router (file-based), TanStack Query v5, TanStack Store, Ant Design v5
- **Backend:** NestJS
- **Database:** Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Shared Types:** `@worldcraft/shared` — auto-generated from Supabase schema
- **Monorepo:** pnpm workspaces + Turborepo
- **Deployment:** Cloudflare Pages (web), container (api)

## Conventions

- **Supabase types** live in `packages/shared/src/types/`. Regenerate with `pnpm db:types`.
- **Migrations** are the source of truth for schema. Never modify schema only through Studio.
- **Frontend components** are max 2 levels deep: `components/[domain]/[Component].tsx`.
- **Backend modules** follow NestJS convention: `modules/[feature]/{module,controller,service}.ts`.
- **Auth:** Frontend uses anon key (RLS enforced). Backend uses service_role key.
- **Environment:** `.env` files per app. Never commit `.env` files.

## PM Workflow

This project uses the PM Bible. See `docs/pm.md` for the full workflow.
Commands: `/pm`, `/p`, `/s`, `/pp`, `/rp`, `/triage`, `/gitpush`, `/bible-sync`.
