# Employee Fill / Sign view wiring

Work Item: AHR-1645 (https://plane.jimbui.dev/aiur/browse/AHR-1645/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: When an employee opens their contract fill page, HR-FILL fields are visible with HR's pre-filled value but cannot be edited. Mandatory fields show the MANDATORY tag and must be filled before submit. Optional fields are editable with no enforcement.

Tech: Two files — `App_ContractFiller.tsx` gains `fillerRole?: 'hr' | 'employee'` prop (default `'hr'`) and per-field mode resolution: when composite `mode='fill'` + `fillerRole='employee'`, HR-state fields resolve to primitive `mode='readonly'` while mandatory + optional stay `mode='fill'`. `Page_OnboardingFiller.tsx` extracts `hr_field_keys` from `invitation.template_snapshot`, passes `hrFieldKeys` + `fillerRole='employee'`. Submit flow unchanged — HR field values already flow through via `prefilledValues` merge with no employee writes.

Related: AHR-1640 — invitation snapshot carries `hr_field_keys`. AHR-1641 — composite + primitive already support `mode='readonly'`, just need per-field resolution. AHR-1643 — sibling wires wizard pre-fill; together they validate the HR-writes-then-employee-reads round-trip.

Siblings: 6 total, 2 Done (local, pending /pp) — AHR-1640 Schema (Done local), AHR-1641 Shared FieldRenderer (Done local), AHR-1642 Composer (In Progress or parallel), AHR-1643 Wizard pre-fill (Todo or parallel), AHR-1644 Review (Todo or parallel)

Execution Order: Step 3 of 3 — prerequisites met ✓. Independent of other step-3 siblings.

## Phase A: App_ContractFiller per-field mode resolution

- [x] Add `fillerRole?: 'hr' | 'employee'` prop to `App_ContractFiller` (default `'hr'`)
- [x] Extract a per-field `effectiveMode` helper inside the composite:
  - If `mode === 'review'` → `'readonly'` for all fields
  - Else if `fillerRole === 'employee'` and field state is `'hr'` → `'readonly'`
  - Else → `'fill'`
- [x] Apply `effectiveMode` to each `<App_FieldRenderer mode={…}>` call in the left-column render loop (including the diff-render branch for review mode, though the diff branch only triggers in review mode so `effectiveMode` resolves to `'readonly'` anyway)
- [x] `disabled` prop on `App_FieldRenderer`: remove the blanket `disabled={isReview}` — readonly mode already shows no input, so `disabled` is redundant. Keep `disabled` only for the diff-render read-only side-by-side (if already set there, retain)

## Phase B: Page_OnboardingFiller wiring

- [x] In `Page_OnboardingFiller.tsx`, extract `hr_field_keys` from the loaded invitation's `template_snapshot` (next to the existing `mandatory_field_keys` extraction). Typecast `as string[]` with `?? []` fallback.
- [x] Pass `hrFieldKeys={snapshotHrFieldKeys}` to `<App_ContractFiller …>` (around line 433)
- [x] Pass `fillerRole='employee'` to the same `<App_ContractFiller>`
- [x] Verify the existing `mandatoryKeys` extraction remains unchanged — it already works for submission validation

## Phase C: Submit path audit (no changes expected)

- [x] Re-read `Page_OnboardingFiller.tsx` submit handler (`handleSubmit` + `mSubmit.mutation.mutate`) — confirm `mergedValues` merges `prefilledValues` (which includes HR-filled values from the invitation) with employee `fieldValues` (which the UI now prevents writing to HR fields)
- [x] Confirm the submit `field_values` payload includes HR field values unchanged from invitation
- [x] Confirm no mandatory-validation regressions — HR fields aren't in `mandatory_field_keys`, so they're not required; mandatory-filled-check still passes on mandatory fields only
- [x] If any adjustment needed (e.g., HR fields accidentally absent from `field_values`), add a task here

## Phase D: Verify

- [x] `pnpm type-check` — must pass (allowing 3 pre-existing errors)
- [x] Manual smoke via dev server: (1) send-invitation (wire dependent on AHR-1643 for HR to pre-fill HR fields, or manually SQL-insert an invitation with HR-filled values), (2) open employee fill page, (3) verify HR-FILL fields render readonly with HR's value visible, (4) verify MANDATORY fields editable and enforce filled-before-submit, (5) verify OPTIONAL fields editable with no enforcement, (6) submit — contract row created with HR values preserved in `field_values`

---

## Plane IDs (populated by /pp)

Phase A: AHR-1772
- Task 1: AHR-1773
- Task 2: AHR-1774
- Task 3: AHR-1775
- Task 4: AHR-1776

Phase B: AHR-1777
- Task 1: AHR-1778
- Task 2: AHR-1779
- Task 3: AHR-1780
- Task 4: AHR-1781

Phase C: AHR-1782
- Task 1: AHR-1783
- Task 2: AHR-1784
- Task 3: AHR-1785
- Task 4: AHR-1786

Phase D: AHR-1787
- Task 1: AHR-1788
- Task 2: AHR-1789
