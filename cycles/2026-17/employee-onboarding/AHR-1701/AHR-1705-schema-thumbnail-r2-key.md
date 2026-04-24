# Schema: add thumbnail_r2_key to files table

Work Item: AHR-1705 (https://plane.jimbui.dev/aiur/browse/AHR-1705/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (Backlog)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Adds a column on the `files` table so uploads can carry a separate thumbnail pointer. No user-facing change in this T2 — plumbing only.

Tech: Single `ALTER TABLE public.files ADD COLUMN thumbnail_r2_key TEXT` migration. Nullable; existing rows default to `NULL`. Regenerate Supabase types — `files.thumbnail_r2_key` becomes a nullable string on `Tables_Row<"files">`. No TS override needed (plain string-or-null). No change to `field_values` shape — the existing `file_id` FK pattern is unchanged.

Related: Upload hook `useM_Files_Upload.ts` currently inserts the `files` row with `{ r2_key, name, content_type, size, uploaded_by, organization_id }`. AHR-1711 (Upload flow emits thumbnails) will extend that INSERT to write `thumbnail_r2_key` when a thumbnail is produced; this T2 just makes the column available.

Siblings: 6 total, 0 Done — AHR-1707 Image thumbnail utility (Todo, Not started), AHR-1709 Doc thumbnail microservice (Todo, Not started), AHR-1711 Upload flow emits thumbnails (Todo, Not started), AHR-1713 App_AttachmentStrip (Todo, Not started), AHR-1715 Wire strip into composite (Todo, Not started)

Execution Order: Step 1 of 5 — no prerequisites (foundation step); unblocks AHR-1707 + AHR-1709 in parallel

## Phase A: Migration

- [x] Create migration `YYYYMMDDHHMMSS_ahr1705_files_add_thumbnail_r2_key.sql` under `frontend/vite/supabase/migrations/`
- [x] `ALTER TABLE public.files ADD COLUMN thumbnail_r2_key TEXT;` — nullable by default, no `DEFAULT` clause (missing thumbnail = NULL, rendered as fallback icon by the strip later)
- [x] Short comment block at top of the file explaining the intent (separate pointer so thumbnail upload is independent of original; failed thumbnail generation leaves NULL and the UI handles the fallback)

## Phase B: Apply + regenerate + verify

- [x] `pnpm sb:dev:push` — apply migration against local DB without data loss
- [x] `supabase db lint --local` (run from `frontend/vite/`) — fix any new warnings; pre-existing `v_idx` shadowed-variable warning from an earlier migration is expected and not owned here
- [x] `pnpm sb:dev:types` — regenerate `src/types/database.types.ts`; confirm `files.Row.thumbnail_r2_key` is present as `string | null` in Row/Insert/Update
- [x] `pnpm type-check` — passes with only the three pre-existing errors (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`); no new errors from this T2
- [x] Spot-check via `docker exec supabase_db_aiur-hr psql` — `\d public.files` should list `thumbnail_r2_key text` as the new column; no change to indexes, constraints, or RLS

---

## Plane IDs (populated by /pp)

Phase A: AHR-1792
- Task 1: AHR-1793
- Task 2: AHR-1794
- Task 3: AHR-1795

Phase B: AHR-1796
- Task 1: AHR-1797
- Task 2: AHR-1798
- Task 3: AHR-1799
- Task 4: AHR-1800
- Task 5: AHR-1801
