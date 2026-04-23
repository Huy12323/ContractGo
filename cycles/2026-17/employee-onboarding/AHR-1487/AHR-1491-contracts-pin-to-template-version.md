# Contracts pin to template version (drop form_snapshot)

Work Item: [AHR-1491](https://plane.jimbui.dev/aiur/browse/AHR-1491/)
Tier 1: [AHR-1487](https://plane.jimbui.dev/aiur/browse/AHR-1487/) [v0.0.1 | Employee Onboarding] Contract template versioning + archive-only lifecycle (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: signed contracts must pin to the exact template content the invitee agreed to. HR review and employee view read the signed contract from the contract's own snapshot; editing or hard-deleting the template has no effect on signed contracts.

Tech: renames `contracts.form_snapshot` → `contracts.template_snapshot` (bare JSONB layout, not restructured), adds `contracts.contract_template_version_id` (NULLABLE FK, ON DELETE SET NULL) with backfill, cleans up submit-contract edge fn (writes snapshot + version_id, drops the now-unneeded separate template fetch), updates 2 frontend references to the renamed column. Also a one-line hotfix to AHR-1490: `onboarding_invitations.contract_template_version_id` gets `DROP NOT NULL` so template hard-delete actually works.

Related: AHR-1490 (invitation snapshot + version pin) — this T2 mirrors that work on contracts and clears the AHR-1490 FK regression discovered during planning.

Siblings: 4 total, 3 Done (local, pending /pp) — AHR-1488 (Done local — schema foundation), AHR-1489 (Done local — trigger), AHR-1490 (Done local — invitation snapshot + version pin)
Execution Order: Step 3 of 3 — all prerequisites Done ✓ (local).

## Phase A: Migration — contract rename + version_id FK + AHR-1490 hotfix

- [x] Create migration file: `cd frontend/vite && supabase migration new ahr1491_contracts_template_snapshot_and_version`
- [x] Header comment block: design intent (column rename, FK added nullable so ON DELETE SET NULL works cleanly, AHR-1490 hotfix folded in)
- [x] PHASE 1: Rename `ALTER TABLE public.contracts RENAME COLUMN form_snapshot TO template_snapshot`
- [x] PHASE 2: Add nullable FK — `ALTER TABLE public.contracts ADD COLUMN contract_template_version_id TEXT REFERENCES public.contract_template_versions(id) ON DELETE SET NULL`
- [x] PHASE 3: Index — `CREATE INDEX idx_contracts_contract_template_version_id ON public.contracts(contract_template_version_id)`
- [x] PHASE 4: Backfill — primary via invitation — `UPDATE public.contracts c SET contract_template_version_id = i.contract_template_version_id FROM public.onboarding_invitations i WHERE c.invitation_id = i.id AND i.contract_template_version_id IS NOT NULL`
- [x] PHASE 5: Backfill — fallback for null-invitation contracts via template v1 — `UPDATE public.contracts c SET contract_template_version_id = v.id FROM public.contract_template_versions v WHERE c.invitation_id IS NULL AND c.contract_template_id IS NOT NULL AND v.template_id = c.contract_template_id AND v.version_number = 1`
- [x] PHASE 6: Hotfix AHR-1490 — `ALTER TABLE public.onboarding_invitations ALTER COLUMN contract_template_version_id DROP NOT NULL`
- [x] PHASE 7: `COMMENT ON TABLE public.contracts IS '...'` (document the snapshot-authoritative + FK-as-provenance model; template edits/deletes cannot affect signed contracts)
- [x] Apply: `supabase db push --local`
- [x] Regenerate types: `pnpm sb:dev:types` (from repo root)
- [x] Lint: `supabase db lint --local` — no new warnings
- [x] Sanity — rename applied: `\d contracts` shows `template_snapshot` column (no `form_snapshot`)
- [x] Sanity — all contracts have `contract_template_version_id` populated after both backfills (0 remaining NULL)
- [x] Sanity — invitation NOT NULL dropped: `information_schema.columns` shows `is_nullable = 'YES'` for invitations.contract_template_version_id
- [x] Sanity — hard-delete a throwaway template now succeeds end-to-end (template → versions cascade → invitation + contract FKs go NULL cleanly; snapshots preserved). Re-run the earlier test that previously failed with NOT NULL violation.

## Phase B: submit-contract edge function — write snapshot + version_id; drop template fetch

- [x] Open `frontend/vite/supabase/functions/employee-onboarding_submit-contract/index.ts`
- [x] Delete the separate `contract_templates` fetch block (currently around lines 138-147) — no longer needed; invitation.template_snapshot has layout, mandatory keys already sourced from snapshot in AHR-1490
- [x] In the contract INSERT payload (around line 193-209):
  - Replace `form_snapshot: template.layout ?? {}` with `template_snapshot: (invitation.template_snapshot as { layout?: unknown }).layout ?? {}` (bare layout, matching the existing contracts schema shape)
  - Add `contract_template_version_id: invitation.contract_template_version_id` alongside the other fields
  - Keep all other fields (organization_id, employee_id, invitation_id, contract_template_id, field_values, prefilled_fields, status, signed_at, signed_by, signer_ip) as-is
- [x] Remove the now-orphan `template` local variable and related error path (the `templateError || !template` 404 block)
- [x] Verify `deno.json` imports unchanged

## Phase C: Frontend — rename form_snapshot references

- [x] Update `frontend/vite/src/hooks/useQ_Tables_Contract.ts`:
  - Change `form_snapshot` to `template_snapshot` in the select projection
  - Add `contract_template_version_id` to the select for future audit/UI use
- [x] Update `frontend/vite/src/components/employees/App_OnboardingReviewModal.tsx`:
  - Line ~196: `qContract.contract.form_snapshot` → `qContract.contract.template_snapshot`
- [x] Grep for any other `form_snapshot` references across `frontend/vite/src` — update if found (expect zero after the two above)
- [x] Typecheck: `pnpm tsc --noEmit` from `frontend/vite/` — no new errors from this T2

## Phase D: Smoke test (manual — end-to-end)

- [ ] Dev server up: `pnpm dev` (from repo root)
- [ ] Full flow: send invitation (as admin) → invitee submits a filled + signed contract → HR reviews in modal → content renders correctly from `template_snapshot`
- [ ] DB check on the new contract: `SELECT template_snapshot IS NOT NULL AS has_snapshot, contract_template_version_id FROM contracts WHERE id = ...` — both populated
- [ ] Edit the template (change content) → HR re-opens the review modal → content unchanged (bug fixed — signed contract frozen)
- [ ] Hard-delete the throwaway template via SDK as admin → succeeds; invitation and contract both retain their snapshots and render; their FKs to `contract_templates` and `contract_template_versions` are now NULL (confirm via psql)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Migration tasks: (pending)

Phase B: (pending)

- submit-contract tasks: (pending)

Phase C: (pending)

- Frontend tasks: (pending)

Phase D: (pending)

- Smoke test: (pending)
