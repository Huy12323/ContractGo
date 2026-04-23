# Invitations pin to template version

Work Item: [AHR-1490](https://plane.jimbui.dev/aiur/browse/AHR-1490/)
Tier 1: [AHR-1487](https://plane.jimbui.dev/aiur/browse/AHR-1487/) [v0.0.1 | Employee Onboarding] Contract template versioning + archive-only lifecycle (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: invitations must pin to the template content as it existed at send time. Editing a template after sending must not change what the invitee sees, nor what validation requires.

Tech: adds `template_snapshot JSONB = {layout, mandatory_field_keys}` + `contract_template_version_id` FK to `onboarding_invitations`. Extends `contract_template_versions` with `mandatory_field_keys TEXT[]` (pre-requisite — folded into Phase A, including trigger + v1 hash recompute). `send-invitation` writes both new columns. `submit-contract` validation switches to read from the invitation snapshot. `useQ_PageOnboardingFiller_InvitationByToken` + `Page_OnboardingFiller` read layout + required keys from the snapshot.

Related: AHR-1488 (versions table foundation), AHR-1489 (trigger + dedup). Both Done locally; this T2 extends them with the mandatory-fields column and adds invitation-side columns.

Siblings: 4 total, 2 Done (local, pending /pp) — AHR-1488 (Done local — schema foundation), AHR-1489 (Done local — trigger), AHR-1491 (Todo, Not started — blocked by this T2)
Execution Order: Step 2 of 3 — prerequisites AHR-1488 + AHR-1489 Done ✓ (local). Parallel-safe slot with AHR-1489 (already done).

## Phase A: Extend versions schema — mandatory_field_keys column + trigger + hash recompute

- [x] Create migration: `supabase migration new ahr1490_versions_mandatory_field_keys` (from `frontend/vite/`)
- [x] Header comment block: rationale (required-field list is versionable content; pre-requisite for invitation snapshot completeness)
- [x] PHASE 1: `ALTER TABLE public.contract_template_versions ADD COLUMN mandatory_field_keys TEXT[] NOT NULL DEFAULT '{}'`
- [x] PHASE 2: Backfill existing v1 rows — `UPDATE public.contract_template_versions v SET mandatory_field_keys = COALESCE(t.mandatory_field_keys, '{}'::TEXT[]) FROM public.contract_templates t WHERE v.template_id = t.id AND v.version_number = 1`
- [x] PHASE 3: Recompute v1 `content_hash` with new formula — `UPDATE public.contract_template_versions SET content_hash = encode(digest(type::text || layout::text || coalesce(pdf_file_path, '') || coalesce(array_to_string(mandatory_field_keys, ','), ''), 'sha256'), 'hex') WHERE version_number = 1`
- [x] PHASE 4: `CREATE OR REPLACE FUNCTION public.write_contract_template_version()` — keep `SECURITY DEFINER SET search_path = public, extensions`; update hash to include `coalesce(array_to_string(NEW.mandatory_field_keys, ','), '')`; add `mandatory_field_keys` to the INSERT column list and VALUES (`NEW.mandatory_field_keys`)
- [x] Apply: `supabase db push --local`
- [x] Lint: `supabase db lint --local` — no new warnings
- [x] Sanity — v1 hashes changed again (new prefixes differ from AHR-1489 values recorded earlier: `679935`, `664e09`, `da669b`, `adad34`, `664e09`)
- [x] Sanity — v1 `mandatory_field_keys` match their parent templates
- [x] Sanity — toggle mandatory key on a throwaway template (e.g., add one): new version written; toggle back to same set: no new version (dedup via hash)

## Phase B: Invitation schema — template_snapshot + contract_template_version_id

- [x] Create migration: `supabase migration new ahr1490_invitations_template_snapshot_and_version`
- [x] Header comment block: authoritative render source + provenance pointer; snapshot is self-contained JSONB `{layout, mandatory_field_keys}`
- [x] PHASE 1: Add both columns (nullable initially for backfill) — `ALTER TABLE public.onboarding_invitations ADD COLUMN template_snapshot JSONB NOT NULL DEFAULT '{}', ADD COLUMN contract_template_version_id TEXT REFERENCES public.contract_template_versions(id) ON DELETE SET NULL`
- [x] Index: `CREATE INDEX idx_onboarding_invitations_contract_template_version_id ON public.onboarding_invitations(contract_template_version_id)`
- [x] PHASE 2: Backfill both — `UPDATE public.onboarding_invitations i SET template_snapshot = jsonb_build_object('layout', t.layout, 'mandatory_field_keys', COALESCE(t.mandatory_field_keys, '{}'::TEXT[])), contract_template_version_id = v.id FROM public.contract_templates t JOIN public.contract_template_versions v ON v.template_id = t.id AND v.version_number = 1 WHERE i.contract_template_id = t.id`
- [x] PHASE 3: Sanity check backfill completeness inside the migration (optional RAISE WARNING if any row has NULL version_id), then `ALTER TABLE public.onboarding_invitations ALTER COLUMN contract_template_version_id SET NOT NULL`
- [x] Apply: `supabase db push --local`
- [x] Regenerate types: `pnpm sb:dev:types` (from repo root)
- [x] Lint: `supabase db lint --local`
- [x] Sanity — every invitation has non-empty `template_snapshot` (with `layout` key) and a valid `contract_template_version_id`

## Phase C: send-invitation edge function — write snapshot + version_id

- [x] Open `frontend/vite/supabase/functions/employee-onboarding_send-invitation/index.ts`
- [x] Between the auth/org guard and the invitation INSERT, add a query: `supabaseAdmin.from('contract_template_versions').select('id, layout, mandatory_field_keys').eq('template_id', contract_template_id).order('version_number', { ascending: false }).limit(1).single()` — return 404 if no version row found (defensive — shouldn't happen after backfill + trigger)
- [x] Update the INSERT into `onboarding_invitations` to include: `template_snapshot: { layout: version.layout, mandatory_field_keys: version.mandatory_field_keys }` AND `contract_template_version_id: version.id`
- [x] Verify `deno.json` imports unchanged; no new external deps
- [x] Smoke test later in Phase F

## Phase D: submit-contract edge function — validation reads from invitation snapshot

- [x] Open `frontend/vite/supabase/functions/employee-onboarding_submit-contract/index.ts`
- [x] Add `template_snapshot` to the invitation SELECT (line ~85: `select("id, organization_id, employee_email, contract_template_id, prefilled_fields, status, template_snapshot")`)
- [x] In the mandatory-field validation block (currently reads `template.layout` and `template.mandatory_field_keys`), cast `invitation.template_snapshot` as `{ layout: unknown; mandatory_field_keys: string[] }` and use those instead of the separate `template` fetch
- [x] Keep the separate `contract_templates` fetch for now — unused by this T2 after the change, but AHR-1491 needs it for the contract INSERT. Leave in place; T2 #4 will rework
- [x] No change to the signer-email guard, resubmit detection, or the contract INSERT payload in this T2

## Phase E: Frontend — filler reads snapshot

- [x] Update `frontend/vite/src/hooks/useQ_PageOnboardingFiller_InvitationByToken.ts`:
  - Add `template_snapshot` to the invitation select projection
  - Remove `layout, mandatory_field_keys` from the `contract_templates(...)` join; keep `id, name`
  - No changes to the return type name or shape of the hook
- [x] Update `frontend/vite/src/pages/Page_OnboardingFiller/Page_OnboardingFiller.tsx`:
  - Replace `const template = invitation?.contract_templates` reads of `layout` / `mandatory_field_keys` with values from `invitation?.template_snapshot` — cast as `{ layout: JSONContent; mandatory_field_keys: string[] }` at use site (or add a `TemplateSnapshot` type alias in `src/types/invitation.types.ts` for clarity)
  - Keep `template?.name` lookups untouched — name still comes from the `contract_templates(id, name)` join
- [x] Typecheck: `pnpm tsc --noEmit` from `frontend/vite/` — no new errors introduced by this T2 (pre-existing errors in `App_LoginForm`, `App_SignUpForm`, `main.tsx` remain out of scope)

## Phase F: Smoke test (end-to-end)

- [ ] Dev server: `pnpm dev` (from repo root)
- [ ] As admin in the browser: send a new onboarding invitation to a test email
- [ ] DB check: `SELECT template_snapshot -> 'layout' IS NOT NULL AS has_layout, jsonb_array_length(template_snapshot -> 'mandatory_field_keys') AS mandatory_count, contract_template_version_id FROM onboarding_invitations WHERE invitation_token = :token` — both populated
- [ ] Sign in as invitee (separate browser/profile), open filler URL — renders the snapshot correctly
- [ ] Back as admin: edit the template content + toggle a mandatory field
- [ ] DB check: new row in `contract_template_versions` (content_hash changed because of the toggle)
- [ ] Refresh invitee filler: content + required-field behavior UNCHANGED (bug fixed — invitee still sees the original snapshot)
- [ ] Submit as invitee: validation uses the snapshotted mandatory fields, not the live template's current list
- [ ] Hard-delete the throwaway template (SDK admin DELETE) — confirm invitation still renders from snapshot (FK goes NULL, snapshot unaffected)

---

## Plane IDs (populated by /pp)

Phase A: (pending)

- Migration tasks: (pending)

Phase B: (pending)

- Migration tasks: (pending)

Phase C: (pending)

- send-invitation tasks: (pending)

Phase D: (pending)

- submit-contract tasks: (pending)

Phase E: (pending)

- Frontend tasks: (pending)

Phase F: (pending)

- Smoke test: (pending)
