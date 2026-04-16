# files metadata table + RLS

Work Item: [AHR-803](https://plane.jimbui.dev/aiur/browse/AHR-803/)
Tier 1: [AHR-797](https://plane.jimbui.dev/aiur/browse/AHR-797/) [v0.0.1 | File Storage] R2 migration + 3-bucket setup + Worker serving (Todo)
Module: [File Storage](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: [File Storage](https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034)
Version Doc: [v0.0.1 File Storage](https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d)

## Context (from spec)

Non-tech: Creates the `files` metadata table that pairs every object stored in R2 with an auditable DB row — records what was uploaded, by whom, and which org owns it (or no org, for user avatars).
Tech: New top-level `public.files` table with branching RLS (org-scope vs user-scope rows distinguished by `organization_id IS NULL`). Uses existing `is_org_member` / `is_admin_or_owner` helpers. No frontend work, no edge functions — pure migration.
Related: R2 infra + Worker bootstrap ([AHR-802](https://plane.jimbui.dev/aiur/browse/AHR-802/)) — sibling foundation; presigned PUT edge fn ([AHR-804](https://plane.jimbui.dev/aiur/browse/AHR-804/)) + Worker auth ([AHR-805](https://plane.jimbui.dev/aiur/browse/AHR-805/)) both INSERT into and read from this table downstream.
Siblings: 7 total, 0 Done — AHR-802 R2 infra (Todo), AHR-804 presigned PUT (Todo), AHR-805 Worker auth (Todo), AHR-806 FE upload hook (Todo), AHR-807 Contract migration (Todo), AHR-808 Supabase Storage decommission (Todo)
Execution Order: Step 1 of 5 — foundation (parallel with AHR-802), no prerequisites ✓

## Convention reconciliations (requirements → project)

- **`organization_id` type:** `TEXT` (not `uuid`) — `organizations.id` is `generate_id('org_')`
- **`uploaded_by` FK target:** `public.profiles(id) ON DELETE SET NULL` (not `auth.users`) — matches `sent_by`, `signed_by`, `created_by` across existing tables
- **`id` PK:** `TEXT PRIMARY KEY DEFAULT generate_id('fil')` — project ID convention
- **`r2_key` index:** the `UNIQUE` constraint auto-creates a B-tree index — no separate `CREATE INDEX` needed
- **`updated_at`:** wire the existing `handle_updated_at()` trigger — matches `profiles` + `organizations` pattern
- **Policy shape:** 8 policies (4 verbs × 2 scopes) — each single-purpose, matches project `{who}_can_{verb}_{what}` naming

## Phase A: Schema + RLS migration

- [x] Create migration file `frontend/vite/supabase/migrations/20260416084344_ahr803_create_files_metadata_table.sql`
- [x] Define `public.files` table with columns: `id TEXT PK generate_id('fil')`, `r2_key TEXT UNIQUE NOT NULL`, `name TEXT NOT NULL`, `content_type TEXT NOT NULL`, `size BIGINT NOT NULL`, `uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL`, `organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE` (NULLABLE), `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`
- [x] Add indexes: `idx_files_organization_id`, `idx_files_uploaded_by` (r2_key auto-indexed by UNIQUE)
- [x] Attach `handle_updated_at()` BEFORE UPDATE trigger (named `on_files_updated`)
- [x] Enable RLS: `ALTER TABLE public.files ENABLE ROW LEVEL SECURITY`
- [x] **SELECT policies (2):**
    - `org_members_can_view_org_scope_files` — USING `organization_id IS NOT NULL AND public.is_org_member(organization_id)`
    - `authenticated_can_view_user_scope_files` — USING `organization_id IS NULL`
- [x] **INSERT policies (2):**
    - `admin_or_owner_can_insert_org_scope_files` — WITH CHECK `organization_id IS NOT NULL AND public.is_admin_or_owner(organization_id)`
    - `uploader_can_insert_user_scope_files` — WITH CHECK `organization_id IS NULL AND uploaded_by = (SELECT auth.uid())`
- [x] **UPDATE policies (2):**
    - `admin_or_owner_can_update_org_scope_files` — USING `organization_id IS NOT NULL AND public.is_admin_or_owner(organization_id)`
    - `uploader_can_update_user_scope_files` — USING `organization_id IS NULL AND uploaded_by = (SELECT auth.uid())`
- [x] **DELETE policies (2):**
    - `admin_or_owner_can_delete_org_scope_files` — USING `organization_id IS NOT NULL AND public.is_admin_or_owner(organization_id)`
    - `uploader_can_delete_user_scope_files` — USING `organization_id IS NULL AND uploaded_by = (SELECT auth.uid())`

## Phase B: Apply + verify + regenerate types

- [x] `pnpm sb:dev:push` — applied via `supabase db push --local`
- [x] `supabase db lint --local` — no new warnings on `files` (pre-existing `public.authorize` errors unrelated to this T2)
- [x] `pnpm -w run sb:dev:types` — regenerated `frontend/vite/src/types/database.types.ts`
- [x] Verified `database.types.ts` `files` block: 9 columns, correct nullability (organization_id `string | null`, uploaded_by `string | null`, size `number`, timestamps `string | null`), 2 FK relationships (organizations + profiles)
- [x] DB introspection: 9 columns + correct types, RLS enabled (`relrowsecurity = t`), 8 policies (2/verb), 4 indexes (PK + r2_key UNIQUE + org_id + uploaded_by), `on_files_updated` trigger present

---

## Plane IDs

Phase A: AHR-810 — Schema + RLS migration

- Create files table + indexes + updated_at trigger: AHR-811
- Enable RLS + 8 branching policies: AHR-812

Phase B: AHR-813 — Apply + verify + regenerate types

- Apply migration + db lint: AHR-814
- Regenerate TypeScript types: AHR-815
- Verify schema + policies via DB introspection: AHR-816
