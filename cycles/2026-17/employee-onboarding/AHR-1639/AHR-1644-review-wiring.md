# Onboarding Review wiring

Work Item: AHR-1644 (https://plane.jimbui.dev/aiur/browse/AHR-1644/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: When HR reviews a filled-and-signed contract in the Review modal, every field shows its MANDATORY / HR-FILL / OPTIONAL tag read-only with the submitted value. No background-fill, legend chip visible.

Tech: One-file change — `App_OnboardingReviewModal.tsx` extracts `mandatory_field_keys` and `hr_field_keys` from `invitation.template_snapshot` (which carries both per AHR-1640's send-invitation update + Phase 6 backfill) and passes them to `<App_ContractFiller mode="review" …>`. `fillerRole` is left unset (default `'hr'`); review mode's blanket `mode="review"` → primitive `mode="readonly"` resolution already handles all fields correctly regardless of filler role.

Related: AHR-1640 — send-invitation function writes `hr_field_keys` into invitation `template_snapshot`; existing invitations backfilled. AHR-1641 — composite's `hrFieldKeys` prop + review-mode readonly rendering already shipped.

Siblings: 6 total, 2 Done (local, pending /pp) — AHR-1640 Schema (Done local), AHR-1641 Shared FieldRenderer (Done local), AHR-1642 Composer (In Progress or parallel), AHR-1643 Wizard pre-fill (Todo or parallel), AHR-1645 Employee Fill (Todo or parallel)

Execution Order: Step 3 of 3 — prerequisites met ✓. Independent of other step-3 siblings.

## Phase A: Review modal wiring

- [x] In `App_OnboardingReviewModal.tsx`, read `invitation.template_snapshot.mandatory_field_keys` and `template_snapshot.hr_field_keys` from the loaded invitation record. Current code already has `qInvitation.invitation` or similar; extend the snapshot parse to extract both key arrays with `?? []` fallback.
- [x] Pass `mandatoryKeys={snapshotMandatoryKeys}` to `<App_ContractFiller mode="review" …>` (around line 194)
- [x] Pass `hrFieldKeys={snapshotHrFieldKeys}` to the same `App_ContractFiller`
- [x] No `fillerRole` prop needed — review mode renders all fields readonly regardless

## Phase B: Verify

- [x] `pnpm type-check` — must pass (allowing 3 pre-existing errors)
- [x] Manual smoke via dev server: (1) open Review modal for a contract whose template had HR-FILL + MANDATORY fields configured, (2) verify the fill cards show both state tags + values, (3) verify legend chip visible (inherited from composite), (4) confirm HR comments / signature / approve actions unchanged

---

## Plane IDs (populated by /pp)

Phase A: AHR-1764
- Task 1: AHR-1765
- Task 2: AHR-1766
- Task 3: AHR-1767
- Task 4: AHR-1768

Phase B: AHR-1769
- Task 1: AHR-1770
- Task 2: AHR-1771
