# ContractGo

Electronic contract platform: document drafting & management, workflow setup with
identity verification, electronic signing, storage, and integration.

> Converted from the AIUR HR template. Live infrastructure identifiers (R2 bucket
> names `aiurhr--{env}`, deployed Worker names `aiur-hr-files-*`, VPS paths and
> hostnames under `aiursoftware.com`, the `aiur` Plane workspace slug) intentionally
> still carry the old name — renaming them is an infra migration, not a code change.

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

## Code Quality

- **Formatting:** Prettier (`.prettierrc`) — 4-space, double quotes, 100 cols, LF.
  `pnpm format`; `pnpm format:check` in CI. Applied to staged files on commit via lint-staged.
- **Linting:** ESLint 9 flat config at `frontend/vite/eslint.config.js`.
  `supabase/functions/**` (Deno) and generated files are excluded by design.
- **All gates:** `pnpm check` — type-check + lint + `deno check` on edge functions, in parallel.
- **Tests:** `pnpm test`. Unit silo only; see `docs/testing.md` for the ladder and the
  rule about importing edge-function code.
- **Never reformat** generated files (`src/routeTree.gen.ts`, `src/types/database.types.ts`)
  or `supabase/migrations/**` — migrations are immutable once applied.
- `react-hooks/exhaustive-deps` is `warn` while three pre-existing warnings are worked down.
  **Fix the dependency, never `eslint-disable`** (see `bible-react-code-style`).
- `pnpm build` is deliberately NOT gated on `pnpm check` — Cloudflare Pages auto-deploys
  on push, so a lint rule must never be able to block a deploy. CI blocks the merge instead.

## PM Workflow

This project uses the PM Bible. See `docs/pm.md` for the full workflow.
Commands: `/pm`, `/p`, `/s`, `/pp`, `/rp`, `/triage`, `/gitpush`, `/bible-sync`, `/load-skills`.
