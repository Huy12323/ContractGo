# Skill Onboarding

Onboarded: 2026-04-02

## bible-react-naming

- **Component prefix:** `App_`
- **Import alias:** `@/`

## bible-react-code-style

No decisions — code style is universal.

## bible-react-provider-context

No decisions — pattern is universal.

## bible-antd-components

No decisions — ANTD v6 is the standard.

**Scaffolding:**
- Created `apps/web/src/providers/antd/Provider_ANTD.tsx`

## bible-env-variables

- **Env validation library:** `jet-env`
- **Vite prefix:** `VITE_`

**Scaffolding:**
- Created `apps/web/src/utils/ENVs/ENVs.ts`
- Installed `jet-env`

## bible-project-structure

- **Frontend app folder:** `apps/web` (monorepo layout)

## bible-supabase-schema

- **PK strategy:** `generate_id('prefix')`
- **Tenant key column:** `organization_id`
- **Realtime:** table-by-table (deferred)

**Scaffolding:**
- Created `supabase/migrations/00000000000000_generate_id.sql`
- Created `packages/shared/src/types/database.override.types.ts`
- Installed `type-fest`

## bible-supabase-rls-policies

- **Tenant key column:** `organization_id`
- **Immutable tables skip UPDATE:** yes (when applicable)
- **DELETE check:** org-member check

## bible-supabase-migrations

- **Delete strategy:** hard deletes
- **Type gen output:** `packages/shared/src/types/database.types.ts`
- **Type gen command:** `pnpm db:types` (root script)

## bible-supabase-edge-functions

No decisions — conventions are universal.

## bible-supabase-cli

- **Supabase directory:** root `supabase/`
- **project_id:** `worldcraft`

## bible-supabase-auth

- **Tenant key column:** `organization_id`
- **Auth providers:** email/password
- **Profile table:** deferred

## bible-supabase-sdk

No decisions — `sb_*` naming is standard.

**Scaffolding:**
- Supabase client exists at `apps/web/src/api/supabase.ts` — needs migration to `apps/web/src/configs/supabase/config.ts` and ENVs integration

## bible-supabase-options

No decisions — `const_*` naming is standard.

**Scaffolding:**
- Created `apps/web/src/utils/options/EnumsToOptions.ts`

## bible-tanstack-query-mutation

- **Cache invalidation:** manual

**Scaffolding:**
- Created `apps/web/src/utils/query/queryKeys.ts`
- Created `apps/web/src/types/utility.types.ts`

## bible-tanstack-router

No decisions — file-based routing is standard.

**Scaffolding:**
- Root route already exists at `apps/web/src/routes/__root.tsx`

## bible-tanstack-store

No decisions — pattern is universal.

**Scaffolding:**
- `@tanstack/store` already installed

## bible-skill-extension

No decisions — extension convention is universal.
