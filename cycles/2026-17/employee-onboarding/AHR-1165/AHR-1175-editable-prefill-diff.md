# Editable prefill + HR-review diff indicator

Work Item: [AHR-1175](https://plane.jimbui.dev/aiur/browse/AHR-1175/)
Tier 1: [AHR-1165](https://plane.jimbui.dev/aiur/browse/AHR-1165/) [v0.0.1 | Employee Onboarding] Onboarding flow rework (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Version Doc: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)

## Context (from spec)

Non-tech: Employees can now edit values HR prefilled (today those fields are locked). During review, HR sees per-field diff cards for any field the employee changed or cleared.

Tech: `App_ContractFiller` gains a `mode` prop (`fill` / `review`) and a `prefilledValues` prop for diff display. Review mode renders dual-input cards when there's a diff (HR prefill top, Employee filled bottom, warning-tinted bg). Review modal swaps its internal TipTap editor for `App_ContractFiller` in review mode — one component for both surfaces.

Related: [AHR-1173](https://plane.jimbui.dev/aiur/browse/AHR-1173/) (schema foundation — no new schema needed here), [AHR-1174](https://plane.jimbui.dev/aiur/browse/AHR-1174/) (parallel sibling — wizard step removal), [AHR-1177](https://plane.jimbui.dev/aiur/browse/AHR-1177/) (consumes reviewable state for the approve/request-changes loop).

Siblings: 7 total, 2 Done (local) — AHR-1173 Done (local, pending /pp), AHR-1174 Done (local, pending /pp), AHR-1176 Todo, AHR-1177 Todo, AHR-1178 Todo, AHR-1179 Todo.

Execution Order: Step 2 of 6 — parallel with AHR-1174 ✓. No blocking prereqs beyond AHR-1173 (schema) which is locally complete.

## Decisions

- **Diff applies to all contract fields**, not just universal employee details (first_name/last_name/birthday). Implementation reuses `App_ContractFiller`'s per-field card list in the review modal — no new panel.
- **Review mode = all inputs disabled.** HR doesn't edit from the filler surface in review; approve/request-changes actions live on the sidebar.
- **Diff visual = card bg switches to warning tint.** Card shows two stacked disabled `FieldControl`s: `HR prefill` above, `Employee filled` below. Cleared prefills render the bottom control as an empty input.
- **Filler merge order flipped:** `mergedValues = {...prefilled, ...fieldValues}`. Prefilled values display as defaults; employee edits (including empty-string clears) override.
- **`fieldValues` state stays empty initially in the filler.** Prefill is only injected via merge at display/submit time — keeps "what the employee actually typed" distinct from "what HR seeded".

## Phase A: App_ContractFiller — editable prefill + review mode

- [x] Remove `readOnlyKeys` prop and its type. Drop the `isLocked` tertiary-grey card variants, the "Pre-filled" secondary label next to the field name, and the `disabled={isLocked}` branch.
- [x] Card bg logic after removal: `colorSuccessBg` / `colorSuccessBorder` when filled, `colorBgTextHover` / transparent when unfilled. Two states, no third.
- [x] Add `mode?: 'fill' | 'review'` prop (default `'fill'`).
- [x] Add `prefilledValues?: Record<string, unknown>` prop. Only consulted when `mode === 'review'`.
- [x] Per-field card render in `review` mode:
  - Compute `hasDiff` = `prefilledValues[f.fieldKey]` is meaningful AND differs from `fieldValues[f.fieldKey]` (use `JSON.stringify` comparison so arrays/objects work)
  - If `hasDiff`: card bg = `token.colorWarningBg`, border = `token.colorWarningBorder`. Render two stacked `FieldControl`s (both `disabled`):
    - Top: small secondary label `HR prefill`, `value={prefilledValues[f.fieldKey]}`
    - Bottom: small secondary label `Employee filled`, `value={fieldValues[f.fieldKey]}` (renders empty input when the employee cleared the field)
  - If `!hasDiff`: single disabled `FieldControl` with `value={fieldValues[f.fieldKey]}`, card bg follows the standard filled/unfilled logic
- [x] All `FieldControl`s in review mode are `disabled={true}` regardless of diff state.
- [x] `fill` mode: existing behavior minus `readOnlyKeys`. `FieldControl` is enabled and fires `onChange`.

## Phase A.1: Page_OnboardingFiller — unlock editing

- [x] Remove the `readOnlyKeys` memo.
- [x] Flip the merge: `mergedValues = {...prefilled, ...fieldValues}`. Employee edits win; `fieldValues[k] = ''` clears a prefill.
- [x] Pass `fieldValues={mergedValues}` to `App_ContractFiller` (so prefilled defaults display immediately).
- [x] `handleFieldChange`: drop the `if (readOnlyKeys.has(key)) return` guard.
- [x] `requiredKeys = extractFieldKeys(layout)` — no `.filter(k => !readOnlyKeys.has(k))` anymore.
- [x] Stop passing `readOnlyKeys` to `App_ContractFiller`.

## Phase B: App_OnboardingReviewModal — swap preview for App_ContractFiller

- [x] Delete the in-file TipTap editor setup:
  - `useEditor({...})` call + its `[qContract.contract?.id]` dep
  - The `StarterKit`/`TextAlign`/`TableKit`/`FieldInput` extension imports (still needed if App_ContractPreview is used elsewhere — keep them imported if so, otherwise remove)
  - The `useEffect` that injects `choicesMap`/`values`/`onChange` into `editor.storage` and dispatches `fieldInputPreviewKey`
  - The `<App_ContractPreview editor={editor} />` render
- [x] Add `const qColumns = useQ_Tables_EmployeeColumns({ organizationId })`. Import the hook.
- [x] Replace the deleted preview block with:
  ```tsx
  <App_ContractFiller
      mode="review"
      layout={qContract.contract.form_snapshot as JSONContent}
      fieldValues={mergedValues}
      prefilledValues={(qContract.contract.prefilled_fields as Record<string, unknown>) ?? {}}
      onChange={() => {}}
      columns={qColumns.columns}
      choices={qChoices.choices}
  />
  ```
- [x] Employee Details sidebar (first_name/last_name/birthday HR fallback inputs, signature display, Approve/Cancel) stays untouched.
- [x] Clean up any now-unused imports (`useEditor`, `StarterKit`, etc. if truly orphaned).

## Phase C: Verify

- [x] `pnpm type-check` — clean on touched files. Pre-existing unrelated errors in auth forms + main.tsx remain.
- [x] Manual end-to-end:
  - HR sends invitation with prefilled values on 3+ fields (mix of text + select + date)
  - Employee opens invitation link: prefilled fields visible and editable (no grey/locked look). Edit one, clear another, fill one previously empty. Submit.
  - HR opens review modal: left sidebar shows per-field cards:
    - Edited field → dual stacked inputs, amber card bg, HR prefill visible above employee value
    - Cleared field → dual stacked inputs, bottom input empty
    - Unchanged prefill → single input, green card bg, merged value
    - Employee-only-fill (no HR baseline) → single input, green card bg
  - Right preview pane renders the contract with merged values inline (TipTap via App_ContractFiller's own editor)
  - Employee Details sidebar (name/birthday) behaves as before
  - Approve completes the flow

---

## Plane IDs (populated by /pp)

Phase A: AHR-1450
- App_ContractFiller mode + prefilledValues + dual-input diff UI: AHR-1451

Phase A.1: AHR-1452
- Page_OnboardingFiller merge flip + remove readOnlyKeys: AHR-1453

Phase B: AHR-1454
- Review modal swap to App_ContractFiller review mode: AHR-1455

Phase C: AHR-1456
- Type-check + manual end-to-end: AHR-1457
