# Contract Filler (HR pre-fill) wiring + missing-mandatory bug fix

Work Item: AHR-1643 (https://plane.jimbui.dev/aiur/browse/AHR-1643/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: In the Onboarding Wizard's "Pre-fill Fields" step (Step 2), HR now sees MANDATORY and HR-FILL state tags on the fill cards and can fill HR-marked fields alongside the rest. The missing-mandatory indicator bug is fixed as a side-effect of the shared renderer.

Tech: One-file change — `App_OnboardingWizardModal.tsx` Step 2 passes `mandatoryKeys` + `hrFieldKeys` from `selectedTemplate` into `App_ContractFiller`. No `fillerRole` needed (defaults to `'hr'` so all fields are editable). Template data already loaded via `useQ_Tables_ContractTemplates` (which includes both key columns per AHR-1640 Phase C).

Related: AHR-1640 (Schema) — template query already selects `hr_field_keys`. AHR-1641 (Shared FieldRenderer) — composite's `hrFieldKeys` prop shipped already. AHR-1642 (Composer) — lands the UI for HR to set HR-state in the first place; this T2 just consumes whatever composer persists.

Siblings: 6 total, 2 Done (local, pending /pp) — AHR-1640 Schema (Done local), AHR-1641 Shared FieldRenderer (Done local), AHR-1642 Composer (In Progress or parallel), AHR-1644 Review (Todo, Not started), AHR-1645 Employee Fill (Todo, Not started)

Execution Order: Step 3 of 3 — prerequisites met ✓ (AHR-1640 + AHR-1641 locally complete). Independent of AHR-1642/1644/1645.

## Phase A: Wizard Step 2 wiring

- [x] In `App_OnboardingWizardModal.tsx` Step 2 block (around line 169), pass `mandatoryKeys={(selectedTemplate.mandatory_field_keys ?? []) as string[]}` to `App_ContractFiller`
- [x] Same block, pass `hrFieldKeys={(selectedTemplate.hr_field_keys ?? []) as string[]}`
- [x] No other props needed — `fillerRole` defaults to `'hr'` (implicit), which keeps all fields editable for HR

## Phase B: Verify

- [x] `pnpm type-check` — must pass (allowing 3 pre-existing errors)
- [x] Manual smoke via dev server: (1) send-invitation flow → Step 2 Pre-fill, (2) select a template that has HR-marked + MANDATORY fields configured (requires AHR-1642 to have shipped or a manual SQL update to set hr_field_keys on a draft template), (3) verify fill cards show HR-FILL + MANDATORY tags, (4) verify all fields are editable, (5) fill values and move to Step 3 — values persist

---

## Plane IDs (populated by /pp)

Phase A: AHR-1757
- Task 1: AHR-1758
- Task 2: AHR-1759
- Task 3: AHR-1760

Phase B: AHR-1761
- Task 1: AHR-1762
- Task 2: AHR-1763
