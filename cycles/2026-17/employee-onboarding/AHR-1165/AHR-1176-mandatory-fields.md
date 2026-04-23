# Mandatory fields — HR marks at template level, filler enforces

Work Item: [AHR-1176](https://plane.jimbui.dev/aiur/browse/AHR-1176/)
Tier 1: [AHR-1165](https://plane.jimbui.dev/aiur/browse/AHR-1165/) [v0.0.1 | Employee Onboarding] Onboarding flow rework (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Version Doc: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)

## Context (from spec)

Non-tech: HR picks which fields the employee must fill. Happens at template creation (Field Composer), not at pre-fill time. The employee filler shows a red asterisk on required fields and blocks submit until they're all non-empty. Submit edge function also validates server-side so someone can't bypass via devtools.

Tech: Builder (`App_FormBuilderModal`) gains a per-field inline asterisk toggle that writes to a `mandatorySet` state; on save, the set is persisted to `contract_templates.mandatory_field_keys` (column exists from AHR-1173). Filler page reads that array via the template join on the invitation query, shows the asterisk (sidebar + TipTap inline), gates submit. Edge fn fetches mandatory keys and validates before inserting the contract row.

Related: [AHR-1173](https://plane.jimbui.dev/aiur/browse/AHR-1173/) (schema foundation: `contract_templates.mandatory_field_keys` column), [AHR-1175](https://plane.jimbui.dev/aiur/browse/AHR-1175/) (editable prefill — cleared submit gate so we can re-introduce a mandatory-only gate here), [AHR-1177](https://plane.jimbui.dev/aiur/browse/AHR-1177/) (comment loop — HR can send back for missing content beyond mandatory keys).

Siblings: 7 total, 3 Done (local) — AHR-1173 ✓, AHR-1174 ✓, AHR-1175 ✓. AHR-1177 Todo, AHR-1178 Todo, AHR-1179 Todo.

Execution Order: Step 3 of 6 — all prereqs (AHR-1173, AHR-1174) effectively Done ✓. AHR-1175 (parallel step 2) also Done ✓.

## Decisions

- **Mandatory toggle = inline asterisk on each TipTap FieldInput node.** Click toggles. Matches filler display pattern. Rejected: sidebar checklist (decouples from node, easier to forget), right-click menu (discoverable poorly).
- **Storage model:** `mandatorySet: Set<string>` in builder state. Persisted on save to `contract_templates.mandatory_field_keys`. Layout JSON stays clean (no `mandatory: boolean` attr on nodes). Separation: layout = shape; column = validation rules.
- **Storage injection pattern:** `mandatorySet` + `onToggleMandatory` injected into TipTap editor storage via `useEffect`, same as existing `choicesMap` / `values`. Node-view reads from storage.
- **Edge fn 400 shape:** `{ error: 'Missing required fields', missing_keys: string[] }` so frontend can resolve labels from the layout and surface them in the error toast.
- **Universal fields** (email/first_name/last_name/birthday) can be marked mandatory when present in the template layout. No special-casing.
- **Stale mandatory keys:** if a key lives in `mandatory_field_keys` but no longer appears in the template layout (HR deleted the field), filler + edge fn both silently ignore it.

## Phase A: Template builder — per-field mandatory toggle

- [x] `App_FormBuilderModal.tsx`:
  - Add `mandatorySet: Set<string>` state (and `setMandatorySet`)
  - On template load: init from `existing.mandatory_field_keys ?? []`
  - On template removal of a field from layout: prune from `mandatorySet` (wire into existing `removedKeys` cleanup path around line 229)
  - Add `mandatorySet` to `isDirty` tracking (compare against `initialStateRef.current.mandatory`)
  - Store `initialStateRef.current.mandatory = JSON.stringify(Array.from(mandatorySet).sort())` after hydration so dirty detection is stable
  - `handleSave` / `handleSaveAs`: pass `mandatory_field_keys: Array.from(mandatorySet)` to `mCreate.mutation.mutateAsync` / `mUpdate.mutation.mutateAsync`
  - Inject into editor storage via `useEffect` (same pattern as `choicesMap` / `values`):
    - `storage.mandatorySet = mandatorySet`
    - `storage.onToggleMandatory = (key: string) => setMandatorySet(prev => new Set with/without key)`
    - `storage.isBuilder = true` (flag so node-view knows to render the toggle)
    - Dispatch `fieldInputPreviewKey` meta to force node-view re-render

- [x] `ext_TipTap_FieldInput.tsx`:
  - Read `mandatorySet`, `onToggleMandatory`, `isBuilder` from editor storage
  - Render red asterisk (`*`) inline after the field label when `mandatorySet.has(fieldKey)`. Use `token.colorError`.
  - In builder mode (`isBuilder === true`): asterisk is clickable (bind onToggleMandatory). In non-builder mode: asterisk is display-only.
  - Non-mandatory field in builder: show a subtle grey asterisk on hover as an affordance to mark mandatory (optional polish — mention in review).

- [x] `useM_ContractTemplate_Create.ts`:
  - Extend params type + mutationFn body with `mandatory_field_keys: string[]`
  - Include in the `.insert()` payload

- [x] `useM_ContractTemplate_Update.ts`:
  - Same: extend params + include in `.update()` payload

## Phase B: Filler — asterisk + mandatory submit gate

- [x] `useQ_PageOnboardingFiller_InvitationByToken.ts`: extend the `contract_templates(...)` join select to include `mandatory_field_keys`.

- [x] `App_ContractFiller.tsx`:
  - Add optional `mandatoryKeys?: string[]` prop
  - Convert to `mandatorySet` memo internally
  - Sidebar card: render red asterisk after field label when `mandatorySet.has(f.fieldKey)`, using `token.colorError`
  - Inject `mandatorySet` (without `onToggleMandatory` / `isBuilder`) into editor storage so the TipTap preview also renders the asterisk

- [x] `Page_OnboardingFiller.tsx`:
  - Re-introduce `hasMeaningfulValue` helper (inline) and import `extractFields` from `App_ContractFiller` (export it if not already)
  - `const mandatoryKeys = template?.mandatory_field_keys ?? []`
  - Pass `mandatoryKeys` to `App_ContractFiller`
  - Submit handler: compute `missing = mandatoryKeys.filter(k => layoutHasKey(k) && !hasMeaningfulValue(mergedValues[k]))`. If any → resolve labels from `extractFields(layout)`, show `message.error('Please fill N required field(s): label1, label2, ...')`, block submission
  - Stale-key handling: `layoutHasKey` comes from `extractFields(layout)` keys — mandatory keys not in the current layout are ignored silently

- [x] Export `extractFields` from `App_ContractFiller.tsx` if not already (it's currently file-local).

## Phase C: Submit edge fn — server-side validation

- [x] `employee-onboarding_submit-contract/index.ts`:
  - Template fetch: extend select to `"id, layout, mandatory_field_keys"`
  - After resolving template, before the contract insert:
    - Compute `layoutKeys` by walking `template.layout` for `fieldInput` nodes (add a small `extractFieldKeys` helper in the edge fn)
    - `missing = (template.mandatory_field_keys ?? []).filter(k => layoutKeys.has(k) && !hasMeaningfulValue(field_values?.[k]))`
    - If `missing.length > 0` → return `400` with `{ error: 'Missing required fields', missing_keys: missing }`

## Phase D: Verify

- [x] `pnpm type-check` — clean
- [x] Manual:
  - Template builder: mark 2 fields mandatory (click asterisks). Red asterisk renders on each. Save. Reopen → asterisks persist.
  - Send invitation using that template with empty prefill on the mandatory fields
  - Filler: red asterisks visible on mandatory fields in sidebar card list AND inline in TipTap preview. Submit with those fields empty → blocked with listing of field labels
  - Fill all mandatory → Submit succeeds
  - Devtools bypass: directly call the `submit-contract` edge fn with `field_values` missing a mandatory key → edge fn returns 400 + `missing_keys` array
  - Delete a mandatory field from the template layout (via builder edit), save → filler re-fetch: key gone from layout, submit no longer asks for it (stale-mandatory silently ignored)

---

## Plane IDs (populated by /pp)

Phase A: AHR-1458
- App_FormBuilderModal mandatorySet state + save: AHR-1459
- ext_TipTap_FieldInput asterisk toggle (via FieldInputContext): AHR-1460
- useM_ContractTemplate_Create/Update mandatory_field_keys param: AHR-1461

Phase B: AHR-1462
- InvitationByToken query mandatory_field_keys select: AHR-1463
- App_ContractFiller mandatoryKeys prop + asterisk render: AHR-1464
- Page_OnboardingFiller submit gate: AHR-1465

Phase C: AHR-1466
- submit-contract edge fn validation: AHR-1467

Phase D: AHR-1468
- Type-check + manual end-to-end: AHR-1469
