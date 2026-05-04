# Schema — pdf kind + positioned-field layout shape + signed_pdf_r2_path

> Version: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) | Tier 1: [AHR-1953](https://plane.jimbui.dev/aiur/browse/AHR-1953/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)

## Requirements

- `contracts.signed_pdf_r2_path TEXT NULL` column exists; FK behaviors and RLS unchanged.
- Invitation `template_snapshot` shape is `{type, layout, pdf_file_path, mandatory_field_keys, hr_field_keys, attachment_field_keys}` for all rows (existing tiptap rows backfilled).
- Contract `template_snapshot` shape is `{type, layout, pdf_file_path}` for all rows (existing rows backfilled by wrapping the bare layout JSONB).
- `send-invitation` and `submit-contract` edge functions write the new snapshot shape going forward.
- `database.types.ts` regenerated; `pnpm typecheck` passes.
- `App_OnboardingReviewModal` reads `template_snapshot.layout` (defensive narrow), keeping tiptap-kind contracts working post-migration.
- `useQ_Tables_Contract` SELECT includes `signed_pdf_r2_path`.
- TypeScript types for the PDF positioned-field layout exist in a shared types file (consumed by builder/filler/burn T2s).

## Scope boundaries

- No UI work — kind selector, builder overlay, filler render path, burn function all live in T2 #2 / #3 / #4.
- No layout JSONB column override in `database.override.types.ts` — both kinds keep `layout: Json` and cast at use sites (matches the existing TipTap pattern).
- Versioning trigger and version-row INSERT are NOT modified — the trigger already hashes `type || layout || pdf_file_path || mandatory_field_keys || hr_field_keys || attachment_field_keys` and copies all of those into version rows (AHR-1791). Layout shape difference between kinds doesn't affect the trigger because both go through the same JSONB column.
- No discriminated-union TS override at the column level — opted for standalone exported types and ad-hoc casts at use sites.

## Decisions

- **Decision:** Extend invitation + contract `template_snapshot` shape to include `type` and `pdf_file_path` so PDF-kind rows are self-sufficient post-template-hard-delete (matches AHR-1487 self-sufficiency invariant).
  **Rationale:** Without this, a template hard-deleted between send-invitation and HR approval would cascade-delete the version row, leaving filler/burn unable to determine kind or fetch the source PDF. Filler (T2 #3) and burn (T2 #4) become pure-consumer work with no schema rework.
- **Decision:** Wrap contract `template_snapshot` from bare JSONB layout to `{type, layout, pdf_file_path}` — existing rows backfilled.
  **Rationale:** Mirrors the structured invitation snapshot shape; one-time consumer fixup (one read site in `App_OnboardingReviewModal`) is small. Defensive read pattern handles any rare unwrapped row.
- **Decision:** PDF positioned-field layout shape is a bare array `[{key, page, x_pct, y_pct, w_pct, h_pct, type}]`.
  **Rationale:** Simplest shape that matches the T2 description. Future overlay-level config (default fontSize, etc.) can be migrated via a versioned shape change later.
- **Decision:** Coordinate values are `0–1` floats per page dimension.
  **Rationale:** Resolution-independent, precise enough for sub-pixel placement, no integer-percent ambiguity.
- **Decision:** PDF layout TS types live in a new file `src/types/contractTemplate.types.ts`.
  **Rationale:** No existing home; co-located with snapshot types since they're all part of the contract-template type surface.
- **Decision:** Estimate adjusts from 2 → 3 pts to reflect snapshot reshape work.
  **Rationale:** Original estimate assumed only the `signed_pdf_r2_path` ALTER. Adding snapshot extension + edge function updates + backfills + one consumer-site fixup pushes it up one Fibonacci step.

Original Estimate: 2 points

## Implementation

### Phase A — Migration

Single migration file adds the new contract column and backfills both snapshot shapes in one atomic transaction.

- [x] Migration file `20260429053147_ahr1954_pdf_kind_foundation.sql` created (wrote directly with timestamp; equivalent to `supabase migration new`)
- [x] Phase 1 inside: `ALTER TABLE public.contracts ADD COLUMN signed_pdf_r2_path TEXT;`
- [x] Phase 2 inside: backfill `onboarding_invitations.template_snapshot` via `||` jsonb concat (preserves existing keys; idempotent via `NOT (template_snapshot ? 'type')` guard)
- [x] Phase 3 inside: backfill `contracts.template_snapshot` via `jsonb_build_object` wrap (idempotent via `NOT (template_snapshot ? 'layout')` guard — disambiguates from ProseMirror's root-level `type` field)
- [x] Phase 4 inside: `COMMENT ON COLUMN` for new column + both snapshot columns documenting the wrapped shape
- [x] Applied locally via `pnpm sb:dev:push`
- [x] `supabase db lint --local` — only pre-existing warning (`v_idx` shadowing in unrelated function); no new issues from this migration

### Phase B — Edge function snapshot writes

Update both edge functions to write the wrapped shape going forward so all new rows are uniform with the backfilled rows.

- [x] `send-invitation`: SELECT extended to include `type, pdf_file_path`; `template_snapshot` payload includes `type: version.type, pdf_file_path: version.pdf_file_path` alongside existing keys
- [x] `submit-contract`: snapshot type guard widened (`type`, `pdf_file_path` added); contract `template_snapshot` write changed from bare layout to wrapped `{type, layout, pdf_file_path}`
- [x] No restart needed — `supabase functions serve` is not running locally (functions hot-reload from disk on next invocation)
- [ ] Smoke deferred to Phase D (manual via UI)

### Phase C — TypeScript types + UI defensive read

- [x] Created `frontend/vite/src/types/contractTemplate.types.ts` with `Pdf_FieldType`, `PdfLayout_PositionedField`, `PdfLayout`, `ContractTemplate_Snapshot` (discriminated union), `Invitation_TemplateSnapshot`
- [x] Regenerated `database.types.ts` — used `supabase gen types typescript --local 2>/dev/null` directly because the project's `pnpm sb:dev:types` script captures stderr into the output file on Windows bash (pre-existing wrapper quirk)
- [x] Verified `database.types.ts` contains `signed_pdf_r2_path: string | null` on contracts Row/Insert/Update
- [x] `useQ_Tables_Contract.ts` SELECT extended to include `signed_pdf_r2_path` (placed after `template_snapshot`)
- [x] `App_OnboardingReviewModal.tsx`: `template_snapshot` read narrowed to `{layout?: JSONContent}.layout` to handle the wrapped contract snapshot shape
- [x] `pnpm type-check` (note: script is `type-check` with hyphen, not `typecheck`) passes

### Phase D — Verification

- [x] psql: `signed_pdf_r2_path` exists as `text NULL` on contracts
- [x] psql: 13/13 invitation snapshots carry `type` key (0 bare)
- [x] psql: 15/15 contract snapshots carry `layout` wrapper key (0 bare)
- [x] psql: 19 tiptap version rows, 0 pdf — no spurious version rows produced by the migration (no `contract_templates` UPDATE touched)
- [ ] **Deferred to user (manual)**: open `Page_OnboardingFiller` for an existing tiptap invitation → renders contract
- [ ] **Deferred to user (manual)**: open `App_OnboardingReviewModal` on a known-tiptap filled contract → renders
- [ ] **Deferred to user (manual)**: no console errors / no broken existing onboarding flows; HR pre-fill / mandatory / attachment behaviors unchanged

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Foundation T2 of AHR-1953 — adds the database column and snapshot shape changes that let the next three T2s (builder, filler, burn) treat PDF-kind contracts the same way TipTap-kind contracts work today, including surviving template hard-delete.
Tech: `contracts` table (new column), `onboarding_invitations.template_snapshot` + `contracts.template_snapshot` (shape change with backfill), `send-invitation` + `submit-contract` edge functions (snapshot write payloads), `useQ_Tables_Contract` (SELECT extends), `App_OnboardingReviewModal` (defensive narrow on snapshot read), new `src/types/contractTemplate.types.ts`.
Related: AHR-1488 / AHR-1490 / AHR-1491 / AHR-1791 — versioning + snapshot infrastructure this T2 extends. AHR-1487 — self-sufficiency invariant for snapshots.
Siblings: 4 total, 0 Done — AHR-1955 PDF builder (Todo, 8 pts), AHR-1956 Employee filler (Todo, 5 pts), AHR-1957 Burn on approve (Todo, 5 pts).
Execution Order: Step 1 of 3 — no prerequisites; foundation for all three follow-ups.
Outline Spec: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff (PDF contract templates — T1 Scoping section)
