# Attachments panel in form builder + attachment_field_keys schema

Work Item: AHR-1791 (https://plane.jimbui.dev/aiur/browse/AHR-1791/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: File-type fields today live inline in the contract body as fieldInput chips — authors add them via the palette just like any other field, and they render as text placeholders. But attachments aren't part of the contract prose; they're supporting documents the employee sends to the employer. This T2 pulls them out of the TipTap layout entirely — the form builder now has a dedicated "Attachments" panel above the editor where file fields are added/removed, and the body layout only contains text, dates, selects, etc. At render time the strip (AHR-1713) already sits above the body in the right column, so the visual shape is already correct — this T2 is about making the AUTHOR surface match the render surface.

Tech: New JSONB column `attachment_field_keys` on `contract_templates` + `contract_template_versions` (same pattern as `mandatory_field_keys` / `hr_field_keys`). One-time Node backfill walks every existing layout, extracts `fieldInput` nodes with `attrs.fieldType === 'file'`, populates the new column, and strips those nodes from the layout tree. `contract_template_versions` versioning trigger (`content_hash`) extended to include the new column. `App_FormBuilderModal` grows an attachments panel above the TipTap editor + state for `attachmentFieldKeys`. Palette click for file-type employee columns appends to that state (bypasses `editor.insertContent`). `App_ContractFiller` accepts `attachmentFieldKeys?: string[]` and consumes it as the source for the strip's `fields` prop (with a legacy fallback to `extractFields(layout)` filtered to `type === 'file'` for frozen invitation snapshots that pre-date this migration). `ext_TipTap_FieldInput` preview branch drops the `fieldType === 'file'` special case (unreachable post-backfill). `employee-onboarding_send-invitation` writes `attachment_field_keys` into the template_snapshot alongside layout + mandatory + hr keys.

Related: `App_AttachmentStrip` (AHR-1713) — render consumer, no change needed; `App_ContractFiller` (AHR-1715) — API widens to accept `attachmentFieldKeys`; `contract_template_versions` trigger (AHR-1640) — extended to hash the new column; `employee-onboarding_send-invitation` (AHR-1715 Phase F) — snapshot includes new column; `App_EmployeeFieldComposerModal` — reused for rename from the attachments panel (same path as inline chip rename).

Siblings: 7 total (including this), 6 Done (local, pending /pp) — AHR-1705 Schema (Done local), AHR-1707 Image utility (Done local), AHR-1709 Doc microservice (Cancelled), AHR-1711 Upload flow (Done local), AHR-1713 Strip component (Done local), AHR-1715 Wire strip (Done local), AHR-1790 Grid thumbnails (Done local)

Execution Order: Not in the T1's original ordered list — discovered mid-execution after AHR-1715 landed. Prereqs effectively satisfied (AHR-1713 + AHR-1715 done locally); this T2 refines the author-surface shape.

## Phase A: Schema + migration + backfill

- [x] Migration `20260424120000_ahr1791_templates_add_attachment_field_keys.sql`: ALTER both tables + update versioning trigger to include `attachment_field_keys` in `content_hash` + INSERT column list (mirrors AHR-1640 pattern). Intentionally does NOT backfill invitation snapshots (leaves frozen audit records alone; consumers use legacy fallback)
- [x] Trigger function `write_contract_template_version` re-emitted in the same migration — hash formula now concatenates `attachment_field_keys::text` after `hr_field_keys::text`
- [x] `pnpm sb:dev:push` applied migration against local DB (preserved data)
- [x] Backfill script at `scripts/backfill-ahr1791-attachment-field-keys.js`: walks each row's layout, extracts file-type fieldInput `fieldKey`s, strips nodes, writes cleaned layout + attachment_field_keys back. Uses `docker exec supabase_db_aiur-hr psql` for SQL execution (Windows dev box doesn't have psql on PATH). Updates versions first + recomputes all version `content_hash`s with the new formula before the templates UPDATE — trigger dedups against the refreshed latest-version hash, so no spurious new version rows
- [x] Backfill executed: 1 template + 1 version updated (5 templates / 18 versions total scanned). Verified via psql: `contract_template_versions.attachment_field_keys` now contains `["col_DUmkBaLXAekq86zj"]` for the affected version
- [x] `pnpm sb:dev:types` regenerated; confirmed `attachment_field_keys: Json` on both table Rows
- [x] Idempotency check: dry-run re-execution reports `0 templates, 0 versions` updates

## Phase B: Query / mutation hooks

- [x] `useQ_Tables_ContractTemplates.ts`: SELECT includes `attachment_field_keys`
- [x] `useQ_Tables_ContractTemplateVersions.ts`: SELECT includes `attachment_field_keys`
- [x] `useM_ContractTemplate_Create.ts`: params accept optional `attachment_field_keys: string[]`
- [x] `useM_ContractTemplate_Update.ts`: body Partial type widened to include `attachment_field_keys`
- [x] `useM_ContractTemplate_Restore.ts`: body requires `attachment_field_keys` + UPDATE payload includes it
- [x] No changes to invitation/contract query hooks — snapshot is JSONB and new key flows through transparently

## Phase C: Form builder UX

- [x] `App_FormBuilderModal.tsx`: `attachmentSet: Set<string>` state + `setAttachmentSet` + `removeAttachment` helper. Init from `existing.attachment_field_keys` on load + `body.attachment_field_keys` on restore
- [x] Palette click handler (`insertField`): file-type branch calls `setAttachmentSet` (dedup via Set); non-file path unchanged (cursor insert)
- [x] `effectiveUsedKeys` combined set (layout + attachments) powers the palette's `isUsed` gray-out check + the prune effect — removing a key from either source clears its mandatory/hr state
- [x] Attachments panel rendered ABOVE the TipTap editor in edit mode only (`attachmentSet.size > 0`). Each card: PaperClip icon + label + `App_FieldStateDropdown` (same HR/MANDATORY/OPTIONAL menu as inline chips) + Close-X remove button
- [x] Dirty check + `initialStateRef` include the sorted `attachment` stringified set
- [x] `handleSave` / `handleSaveAs` pass `attachment_field_keys` in create/update payloads
- [x] Preview mode passes `attachmentFieldKeys={Array.from(attachmentSet)}` to `App_ContractFiller` so the strip reflects the in-progress builder state
- [x] `App_ContractTemplateVersionsModal` restore flow: `OnRestored` type widened to include `attachment_field_keys`; modal passes it through `mRestore` + the callback. Rename UX not implemented in v1 (existing `App_EmployeeFieldComposerModal` path works for inline chips; attachment cards show labels read-only for now — follow-up)

## Phase D: Strip wiring — read from new source

- [x] `App_ContractFiller.tsx`: new `attachmentFieldKeys?: string[]` prop. When provided, builds `fileFields` by resolving each key via `UNIVERSAL_FIELDS` + `columns`. When omitted, falls back to filtering layout-extracted fields for `type === 'file'` (legacy invitation snapshots)
- [x] Wired through all 5 surfaces:
  - `App_FormBuilderModal` preview — `Array.from(attachmentSet)`
  - `App_OnboardingWizardModal` step 2 — `selectedTemplate.attachment_field_keys`
  - `Page_OnboardingFiller` — `snapshot.attachment_field_keys` (or `undefined` → legacy layout fallback)
  - `App_OnboardingReviewModal` — `snapshotKeys.attachmentFieldKeys` (or `undefined`)
  - `App_ContractTemplateVersionsModal` — `selected.attachment_field_keys`

## Phase E: TipTap cleanup

- [x] `ext_TipTap_FieldInput.tsx`: kept the `fieldType === 'file'` early return as a defensive path for legacy invitation snapshots that predate the backfill. Updated the comment to explain the AHR-1791 split and why the branch remains
- [x] No other stale assumptions found via grep — `extractFields` callers either live inside `App_ContractFiller` (already rewritten) or don't branch on file-type

## Phase F: Send-invitation snapshot

- [x] `employee-onboarding_send-invitation/index.ts`: SELECT includes `attachment_field_keys`; `template_snapshot` carries it alongside layout/mandatory/hr

## Phase G: Verify

- [x] `pnpm type-check` — only the three pre-existing errors (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`); no new errors
- [x] Backfill idempotency confirmed — dry-run reports zero changes post-run
- [~] Smoke testing deferred to user (agent can't exercise the dev-server flows end-to-end):
  1. Form builder — add/remove file fields via palette, verify attachments panel only
  2. Existing template — open an already-saved template, verify file fields appear in the attachments panel (not the body)
  3. Preview mode — strip above body with attachments; body reads `(see attachments)`
  4. Full invitation flow — HR pre-fill → Send → employee fill → review
  5. Versions modal + restore — attachments preserved across version switches

---

## Plane IDs (populated by /pp)

Phase A: AHR-1895
- Task 1: AHR-1904
- Task 2: AHR-1906
- Task 3: AHR-1907
- Task 4: AHR-1908
- Task 5: AHR-1909
- Task 6: AHR-1910
- Task 7: AHR-1912

Phase B: AHR-1896
- Task 1: AHR-1916
- Task 2: AHR-1917
- Task 3: AHR-1919
- Task 4: AHR-1920
- Task 5: AHR-1922
- Task 6: AHR-1923

Phase C: AHR-1897
- Task 1: AHR-1927
- Task 2: AHR-1929
- Task 3: AHR-1930
- Task 4: AHR-1931
- Task 5: AHR-1932
- Task 6: AHR-1934

Phase D: AHR-1898
- Task 1: AHR-1936
- Task 2: AHR-1937

Phase E: AHR-1899
- Task 1: AHR-1938
- Task 2: AHR-1939

Phase F: AHR-1901
- Task 1: AHR-1940

Phase G: AHR-1902
- Task 1: AHR-1941
- Task 2: AHR-1942
- Task 3: AHR-1943
