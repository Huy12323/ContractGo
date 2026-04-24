# Form Builder / Contract Composer wiring

Work Item: AHR-1642 (https://plane.jimbui.dev/aiur/browse/AHR-1642/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: HR marks fields in the composer as HR-FILL, MANDATORY, or OPTIONAL (cycling via click on the state tag inside the field chip). Save persists both key sets; restoring an old version brings back the matching HR/mandatory key sets.

Tech: `App_FormBuilderModal.tsx` gains `hrSet: Set<string>` state alongside the existing `mandatorySet`. `onToggleState` replaces the AHR-1641 placeholder bridge with real 3-state logic (app-side mutual exclusivity). Save payload (`useM_ContractTemplate_Create`/`_Update`) includes `hr_field_keys`. `App_ContractTemplateVersionsModal`'s restore callback + preview pane carry `hr_field_keys` through. Legend chip lands in the composer toolbar next to the Preview toggle.

Related: AHR-1641 (Shared FieldRenderer) ([Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)) — provides the `FieldRendererContext` shape, the chip toggle UX, and the composite that `App_ContractTemplateVersionsModal` uses for version preview. AHR-1640 (Schema) — mutation hooks already accept `hr_field_keys`, no hook-level changes here.

Siblings: 6 total, 2 Done (local, pending /pp) — AHR-1640 Schema (Done local), AHR-1641 Shared FieldRenderer (Done local), AHR-1643 Filler (Todo, Not started), AHR-1644 Review (Todo, Not started), AHR-1645 Employee Fill (Todo, Not started)

Execution Order: Step 3 of 3 — prerequisites met ✓ (AHR-1640 + AHR-1641 locally complete). AHR-1643/1644/1645 can land in any order alongside this.

## Phase A: Composer state mgmt

- [x] In `App_FormBuilderModal.tsx`: add `hrSet: Set<string>` state via `useState<Set<string>>(new Set())` next to the existing `mandatorySet` state
- [x] Hydrate `hrSet` from template on load — same `useEffect` that seeds `mandatorySet` from `template.mandatory_field_keys` now also seeds `hrSet` from `template.hr_field_keys`
- [x] Replace the AHR-1641 placeholder `onToggleState` in `fieldRendererContextValue` with real 3-state logic:
  - `nextState === 'mandatory'`: `mandatorySet.add(key)` + `hrSet.delete(key)`
  - `nextState === 'hr'`: `hrSet.add(key)` + `mandatorySet.delete(key)`
  - `nextState === 'optional'`: both sets delete the key
- [x] Update `fieldRendererContextValue` to pass the real `hrSet` (not `emptyHrSet`)
- [x] Remove the `emptyHrSet` placeholder memo + its comment

## Phase B: Dirty tracking + save payload

- [x] Extend `initialStateRef` (composer's dirty-detection baseline) to capture `hrSet` alongside `mandatorySet`
- [x] Extend the composer's dirty check — any diff between current `hrSet` and `initialStateRef.hrSet` marks the draft as dirty (parallel to mandatorySet)
- [x] `handleSave` payload for `useM_ContractTemplate_Create.mutate`: include `hr_field_keys: Array.from(hrSet)`
- [x] `handleSave` payload for `useM_ContractTemplate_Update.mutate`: include `hr_field_keys: Array.from(hrSet)`
- [x] After save success, update `initialStateRef` to include the just-persisted `hrSet` so the draft settles clean

## Phase C: Restore-from-version propagation

- [x] `App_ContractTemplateVersionsModal.tsx` `handleRestore` onOk callback: `restoredHr` variable already exists (from AHR-1640 Phase C). Extend the `onRestored({ ... })` call to include `hr_field_keys: restoredHr`
- [x] Extend the `App_ContractTemplateVersionsModal_OnRestored` type in `App_ContractTemplateVersionsModal.tsx` (exported) to add `hr_field_keys: string[]` alongside `mandatory_field_keys`
- [x] In `App_FormBuilderModal.tsx`, the `onRestored` callback handler: after applying restored layout/type/pdf_file_path/mandatory, also apply `setHrSet(new Set(payload.hr_field_keys))`
- [x] Re-anchor `initialStateRef` in the restore handler to include the restored hrSet (so restore lands in a clean-not-dirty state)

## Phase D: Version history preview wiring

- [x] In `App_ContractTemplateVersionsModal.tsx` preview pane: compute `previewHrFieldKeys = (selected?.hr_field_keys ?? []) as string[]` alongside the existing `previewMandatoryKeys`
- [x] Pass `hrFieldKeys={previewHrFieldKeys}` to `<App_ContractFiller mode="review" …>`

## Phase E: Legend chip in toolbar

- [x] Import `App_FieldLegendChip` in `App_FormBuilderModal.tsx`
- [x] Add `<App_FieldLegendChip />` to the composer toolbar, positioned next to the Preview toggle button
- [x] Verify visibility in both edit mode (preview=false) and preview mode (preview=true)

## Phase F: Verify

- [x] `pnpm type-check` — must pass (allowing 3 pre-existing errors)
- [x] Manual smoke via dev server: (1) open composer for an existing template, (2) cycle a field through optional → mandatory → hr → optional via chip click, (3) save, (4) reopen — state persisted. (5) Restore a prior version — hrSet resets to that version's keys. (6) Legend chip visible + popover works in both modes.

---

## Plane IDs (populated by /pp)

Phase A: AHR-1730
- Task 1: AHR-1731
- Task 2: AHR-1732
- Task 3: AHR-1733
- Task 4: AHR-1734
- Task 5: AHR-1735

Phase B: AHR-1736
- Task 1: AHR-1737
- Task 2: AHR-1738
- Task 3: AHR-1739
- Task 4: AHR-1740
- Task 5: AHR-1741

Phase C: AHR-1742
- Task 1: AHR-1743
- Task 2: AHR-1744
- Task 3: AHR-1745
- Task 4: AHR-1746

Phase D: AHR-1747
- Task 1: AHR-1748
- Task 2: AHR-1749

Phase E: AHR-1750
- Task 1: AHR-1751
- Task 2: AHR-1752
- Task 3: AHR-1753

Phase F: AHR-1754
- Task 1: AHR-1755
- Task 2: AHR-1756
