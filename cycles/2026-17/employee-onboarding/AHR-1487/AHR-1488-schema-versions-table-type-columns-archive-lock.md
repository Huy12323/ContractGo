# Schema: versions table + type columns + archive-only DELETE lock

Work Item: [AHR-1488](https://plane.jimbui.dev/aiur/browse/AHR-1488/)
Tier 1: [AHR-1487](https://plane.jimbui.dev/aiur/browse/AHR-1487/) [v0.0.1 | Employee Onboarding] Contract template versioning + archive-only lifecycle (Todo)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: HR edits contract templates; today editing mutates live invitations (bug). New design combines versioning (audit/history) with snapshot columns on invitations/contracts (authoritative render source) — invitations/contracts become self-contained so templates can even be hard-deleted safely. Archive (`is_archived`) remains the default HR UX for retiring in-use templates.

Tech: creates `contract_template_versions` table, adds `type`/`pdf_file_path` to `contract_templates`, backfills v1 per template, swaps the CASCADE FK on `onboarding_invitations.contract_template_id` to SET NULL (the core bug fix). Snapshot columns are added in later T2s (3, 4). No trigger yet — T2 #2.

Related: None for this T2 — pure schema foundation.

Siblings: 4 total, 0 Done — AHR-1489 (Todo, trigger), AHR-1490 (Todo, invitation snapshot + version pin), AHR-1491 (Todo, contract snapshot + version pin)
Execution Order: Step 1 of 3 — foundation, unblocks AHR-1489 and AHR-1490 (parallel). AHR-1491 depends on AHR-1490.

## Phase A: Migration SQL (single file)

- [x] Create migration file: `cd frontend/vite && supabase migration new ahr1488_contract_template_versions`
- [x] Write header comment block documenting design intent (versioning for audit, snapshot columns added in later T2s, hard-delete permitted via existing admin_or_owner RLS, invitation FK swap from CASCADE to SET NULL is the core bug fix)
- [x] PHASE 1: Create enum `CREATE TYPE public.contract_template_type_enum AS ENUM ('tiptap', 'pdf');`
- [x] PHASE 2: Alter `contract_templates` — `ADD COLUMN type contract_template_type_enum NOT NULL DEFAULT 'tiptap'`, `ADD COLUMN pdf_file_path TEXT`
- [x] PHASE 3: Create `contract_template_versions` table with columns: `id TEXT PRIMARY KEY DEFAULT generate_id('ctv')`, `template_id TEXT NOT NULL REFERENCES contract_templates(id) ON DELETE CASCADE`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `version_number INTEGER NOT NULL`, `type contract_template_type_enum NOT NULL`, `layout JSONB NOT NULL DEFAULT '{}'`, `pdf_file_path TEXT`, `content_hash TEXT NOT NULL`, `created_at TIMESTAMPTZ DEFAULT now()`, `created_by UUID REFERENCES profiles(id) ON DELETE SET NULL`, plus `UNIQUE (template_id, version_number)`
- [x] Indexes: `CREATE INDEX idx_contract_template_versions_template_id ON public.contract_template_versions(template_id)` and `CREATE INDEX idx_contract_template_versions_organization_id ON public.contract_template_versions(organization_id)`
- [x] PHASE 4: RLS on versions — `ALTER TABLE public.contract_template_versions ENABLE ROW LEVEL SECURITY;` + single `admin_or_owner_can_view_contract_template_versions` SELECT policy using `public.is_admin_or_owner(organization_id)`. No INSERT/UPDATE/DELETE policies (trigger in T2 #2 is SECURITY DEFINER; absence of policies enforces immutability)
- [x] PHASE 5: Backfill v1 rows via `INSERT INTO public.contract_template_versions (template_id, organization_id, version_number, type, layout, pdf_file_path, content_hash, created_by) SELECT id, organization_id, 1, type, layout, pdf_file_path, encode(digest(layout::text || coalesce(pdf_file_path, ''), 'sha256'), 'hex'), NULL FROM public.contract_templates`
- [x] PHASE 6: Swap `onboarding_invitations.contract_template_id` FK — `DROP CONSTRAINT onboarding_invitations_contract_template_id_fkey`, `ALTER COLUMN contract_template_id DROP NOT NULL`, `ADD CONSTRAINT onboarding_invitations_contract_template_id_fkey FOREIGN KEY (contract_template_id) REFERENCES public.contract_templates(id) ON DELETE SET NULL`
- [x] PHASE 7: `COMMENT ON TABLE public.contract_templates IS '...'` (describe archive as default UX, hard-delete permitted, snapshot columns on invitations/contracts keep rows self-contained) and `COMMENT ON TABLE public.contract_template_versions IS '...'` (immutable audit trail, written only by trigger from T2 #2, cascade-deletes with template)

## Phase B: Apply, regenerate, verify

- [x] Apply migration: `cd frontend/vite && supabase db push --local` (preserves existing data; no reset)
- [x] Regenerate types: `pnpm sb:dev:types`
- [x] Lint schema: `cd frontend/vite && supabase db lint --local` — resolve any warnings
- [x] Verify `frontend/vite/src/types/database.types.ts` includes `contract_template_type_enum`, new columns on `contract_templates`, and full `contract_template_versions` Row/Insert/Update types
- [x] Sanity — backfill coverage: `psql <<'SQL' SELECT count(*) FROM public.contract_templates t LEFT JOIN public.contract_template_versions v ON v.template_id = t.id WHERE v.id IS NULL; SQL` returns 0
- [x] Sanity — invitation FK is SET NULL: psql `\d public.onboarding_invitations` shows the FK with `ON DELETE SET NULL`
- [x] Sanity — hard-delete a throwaway unused template via authenticated SDK (admin role) — succeeds; if any invitation referenced it (unlikely for throwaway), that invitation's `contract_template_id` is now NULL and row still exists
- [x] Sanity — org delete cascades cleanly on a throwaway org with templates + invitations + contracts + versions — all rows gone, no strays in any referenced table
- [x] Sanity — unauthorized user cannot SELECT from `contract_template_versions` (invitee or org-less user returns zero rows)

## Phase C: Frontend type-awareness + checkpoint

- [x] Add entry to `QueryKeys` factory at `frontend/vite/src/utils/query/queryKeys.ts`: `contract_template_versions: createTableFactory("contract_template_versions")`
- [x] Verify TS compiles — `QueryKeys` `satisfies Record<TableName, ...>` completeness check passes
- [ ] Commit as one unit: migration SQL + regenerated `database.types.ts` + updated `queryKeys.ts`

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Migration tasks: (pending)

Phase B: (pending)

- Apply/lint tasks: (pending)

Phase C: (pending)

- QueryKeys + commit: (pending)
