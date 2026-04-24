# Shared FieldRenderer + 3-state indicator + legend dropdown chip

Work Item: AHR-1641 (https://plane.jimbui.dev/aiur/browse/AHR-1641/)
Tier 1: AHR-1639 [v0.0.1 | Employee Onboarding] Unified field-state system — HR field type, indicator redesign, shared FieldRenderer (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: One shared primitive (the "fill card": label + input + state badge) and one composite (fill cards + TipTap body with inline values + legend chip) used at four places — template builder preview, HR pre-fill, employee filling, and version history viewer. Retires the background-fill preview style in favor of explicit text labels ("HR-FILL" / "MANDATORY" / "OPTIONAL").

Tech: Two new files — `App_FieldRenderer.tsx` (the fill card atom) and `App_FieldLegendChip.tsx` (dropdown legend). `App_ContractFiller.tsx` rewritten in place to become the composite using the new primitives (filename retained for caller compatibility). `ext_TipTap_FieldInput.tsx` preview branch becomes plain-text inline value rendering (no chip, no bg); edit branch keeps chip shape but replaces `*` asterisk toggle with a text state badge. `FieldInputContext` → `FieldRendererContext` widened to `{ hrSet, mandatorySet, mode, isBuilder, onToggleState }`. Dev-only sandbox route `/_field-renderer-sandbox` for visual matrix validation, removed before /pp.

Related: AHR-1640 (Schema) ([Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff)) — provides the `hr_field_keys` column + hook types that the composite now accepts. `App_ContractFiller` gains an optional `hrFieldKeys?: string[]` prop (defaults `[]`) so callsites in T2 #3–#6 can pass real values.

Siblings: 6 total, 1 Done (local, pending /pp) — AHR-1640 Schema (Done local), AHR-1642 Composer wiring (Todo, Not started), AHR-1643 Filler wiring (Todo, Not started), AHR-1644 Wizard + Review wiring (Todo, Not started), AHR-1645 Employee view wiring (Todo, Not started)

Execution Order: Step 2 of 3 — prerequisites met ✓ (AHR-1640 schema locally complete)

## Phase A: FieldRenderer primitive

- [x] Create `frontend/vite/src/components/employees/App_FieldRenderer.tsx`
- [x] Props: `{ fieldKey: string; fieldLabel: string; fieldType: string; state: 'hr' | 'mandatory' | 'optional'; mode: 'fill' | 'readonly'; value: unknown; onChange?: (value: unknown) => void; choices?: Array<{ label: string; value: string }>; disabled?: boolean }` — `edit` mode dropped (composer chip lives in `ext_TipTap_FieldInput`, not this primitive)
- [x] Renders a fill card: plain div wrapper with label (Typography.Text secondary) + state text badge + input control
- [x] Input control switches on `fieldType`: Input (default), InputNumber, DatePicker, Switch, Select (multi_select) — extracted into `InputControl` subcomponent
- [x] `mode='readonly'`: renders via `ReadonlyDisplay` — Typography.Text for filled value, italic muted `fieldLabel` for empty
- [x] State badge: `StateBadge` subcomponent — text "HR-FILL" / "MANDATORY" (hidden for optional) using `token.colorInfo` / `token.colorError`
- [x] No background-fill anywhere on the card (neutral border only)
- [x] All styling via `theme.useToken()` — no hardcoded values

## Phase B: Legend dropdown chip

- [x] Create `frontend/vite/src/components/employees/App_FieldLegendChip.tsx`
- [x] Renders as ANTD `Tag` with "Legend" + chevron-down icon (lucide `ChevronDown`)
- [x] Click opens ANTD `Popover` with three `LegendRow` entries (HR-FILL / MANDATORY / OPTIONAL + one-line description each)
- [x] All colors via `token.*` (`colorInfo` / `colorError` / `colorTextTertiary`)

## Phase C: FieldRendererContext

- [x] In `ext_TipTap_FieldInput.tsx`: rename `FieldInputContext` → `FieldRendererContext` + `FieldInputContextValue` → `FieldRendererContextValue`
- [x] Widen shape to `{ hrSet, mandatorySet, mode: 'fill'|'readonly', isBuilder, onToggleState }`
- [x] `onToggleState(key, nextState)` replaces `onToggleMandatory(key)`
- [x] Default context value updated: empty sets, `mode: 'readonly'`, `isBuilder: false`
- [x] Update `App_ContractFiller.tsx` consumer to provide the new shape
- [x] **Follow-up (added during execution):** update `App_FormBuilderModal.tsx` — same rename + bridge `onToggleState` to its existing `toggleMandatory` (mandatory↔optional works; 'hr' state is a no-op here, wired properly in AHR-1642)

## Phase D: Rewrite App_ContractFiller as the composite

- [x] Keep filename `App_ContractFiller.tsx` (caller-compatible — `Page_OnboardingFiller`, `App_OnboardingReviewModal`, `App_ContractTemplateVersionsModal` unchanged)
- [x] Add `hrFieldKeys?: string[]` prop (defaults `[]`)
- [x] Removed local `FieldControl` component entirely
- [x] Per-field state resolution via local `resolveFieldState(key, hrSet, mandatorySet)`
- [x] Left column: renders each field via `App_FieldRenderer`; review mode with diff renders two renderers (HR prefill + Employee filled) stacked
- [x] Header row gets `App_FieldLegendChip` next to the "Pre-fill"/"Fields" title
- [x] `FieldRendererContext.Provider` provides `{ hrSet, mandatorySet, mode, isBuilder: false }` — no `onToggleState` (consumers in fill/review contexts don't toggle state)
- [x] `useQ_Tables_EmployeeColumns` + `useQ_Tables_EmployeeColumnChoices` unchanged

## Phase E: ext_TipTap_FieldInput inline rendering

- [x] Preview branch: plain inline value text (no chip, no bg)
- [x] `hasValue`: renders resolved `displayText` inline with `verticalAlign: 'baseline'` only
- [x] Empty: italic `[fieldLabel]` in `token.colorTextPlaceholder`
- [x] Removed trailing `*` indicator in preview — state lives on fill card only
- [x] Edit branch: chip kept (border + left accent) but toggle is now a text state badge ("HR-FILL" / "MANDATORY" / "OPTIONAL"). Clicking cycles optional → mandatory → hr → optional via `onToggleState`
- [x] Dropped `colorErrorBg` / `colorPrimaryBg` background-fill from edit chip; only the colored left border remains as the state accent
- [x] State reads come from `FieldRendererContext` via `resolveState(key, hrSet, mandatorySet)` helper

## Phase F: Sandbox route

- [x] Created `frontend/vite/src/routes/field-renderer-sandbox.tsx` at URL `/field-renderer-sandbox` — standalone public route (no auth gate). **Deviation from plan:** dropped the leading `_` because in TanStack Router `_prefix.tsx` means a *layout route* (pathless, requires Outlet + children). A standalone sandbox doesn't need layout semantics; it just needs to sit outside the `_auth`/`_protected` trees so it loads without login. Getting it "out of nav" is about not adding a nav entry, not about the filename prefix.
- [x] Matrix: state × mode × fieldType (3 × 2 × 5 = 30 combos) + extra row for empty-value readonly rendering
- [x] `App_FieldLegendChip` mounted at the top
- [x] Amber `Alert` banner at top: "Sandbox route — remove before /pp"
- [x] Accessible at `/field-renderer-sandbox` — not linked from any nav
- [x] Manual sandbox verification deferred to whoever opens the route; typecheck pass is the automated gate

## Phase G: Architecture tree + cleanup

- [x] `pnpm type-check` — passes with only the three pre-existing errors (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`), none from AHR-1641
- [x] Write architecture tree inline (Phase H below — populated)
- [x] **REMINDER FOR /pp:** Before `/pp` on AHR-1641, delete `frontend/vite/src/routes/field-renderer-sandbox.tsx`. The route tree (`src/routeTree.gen.ts`) will auto-regenerate on next dev server run; if regeneration needs priming, touch any route file. Then run `pnpm type-check` to confirm no orphan references.

## Phase H: Architecture tree (populated)

```
frontend/vite/src/
├── components/employees/
│   ├── App_FieldRenderer.tsx           NEW — fill card primitive (label + state badge + input/readonly)
│   │     Handles: single-field render in 'fill' or 'readonly' mode
│   │     Props: fieldKey, fieldLabel, fieldType, state, mode, value, onChange?, choices?, disabled?
│   │     Injects: nothing — pure primitive
│   │     Subcomponents: StateBadge, InputControl, ReadonlyDisplay (file-local)
│   │
│   ├── App_FieldLegendChip.tsx         NEW — dropdown chip explaining the 3 states
│   │     Handles: click-to-reveal popover with HR-FILL / MANDATORY / OPTIONAL descriptions
│   │     Props: none
│   │     Injects: nothing
│   │
│   ├── App_ContractFiller.tsx          REWRITTEN — composite used at 4 surfaces
│   │     Handles: left column of fill cards + right column TipTap body
│   │     Props: layout, fieldValues, onChange, columns, choices, mode?, prefilledValues?,
│   │            mandatoryKeys?, hrFieldKeys?
│   │     Injects into FieldRendererContext.Provider:
│   │       { hrSet, mandatorySet, mode: 'fill'|'readonly' derived from mode prop,
│   │         isBuilder: false }
│   │     Injects into editor.storage.fieldInput:
│   │       { choicesMap, values: fieldValues, onChange }
│   │     Surfaces using it: Page_OnboardingFiller, App_OnboardingReviewModal,
│   │                        App_ContractTemplateVersionsModal (via AHR-1558 preview)
│   │                        [+ Form Builder preview once AHR-1642 wires it]
│   │
│   ├── ext_TipTap_FieldInput.tsx       MODIFIED — TipTap inline node
│   │     Exports: FieldInput (node), FieldRendererContext, fieldInputPreviewKey,
│   │              FieldRendererContextValue, FieldRendererContext_State,
│   │              FieldRendererContext_Mode
│   │     NodeView (FieldInputComponent) reads from FieldRendererContext:
│   │       hrSet, mandatorySet, isBuilder, onToggleState
│   │     Preview branch: plain inline value text or italic placeholder (no chip, no bg)
│   │     Edit branch: labeled chip with border-left accent colored per state + text state
│   │                  badge that cycles state when isBuilder && onToggleState present
│   │
│   └── App_FormBuilderModal.tsx        MODIFIED — composer (T2 #3 still owns the UI work)
│         Injects into FieldRendererContext.Provider:
│           { hrSet: empty Set (T2 #3 will wire), mandatorySet, mode: 'fill',
│             isBuilder: true,
│             onToggleState: bridge to existing toggleMandatory (mandatory↔optional only) }
│
└── routes/
    └── field-renderer-sandbox.tsx     NEW (DEV-ONLY — DELETE BEFORE /pp)
          URL: /field-renderer-sandbox
          Matrix: state × mode × fieldType (3 × 2 × 5 = 30 combos) + empty-value row
```

**Context flow at a glance:**

```
[App_ContractFiller composite]  ←── 4 surfaces call here
    │
    ├─ FieldRendererContext.Provider({ hrSet, mandatorySet, mode, isBuilder:false })
    │       │
    │       └─ [TipTap editor + FieldInput NodeView]   (right column)
    │              └─ reads hrSet + mandatorySet to decide inline rendering
    │                 (value text or italic placeholder)
    │
    └─ [fill card list — map fields → App_FieldRenderer]   (left column)
           └─ consumes App_FieldRenderer.props.state from resolveFieldState()
              (no context read — props-driven)

[App_FormBuilderModal] (composer)
    │
    └─ FieldRendererContext.Provider({ hrSet:{}, mandatorySet, mode:'fill', isBuilder:true, onToggleState })
           │
           └─ [TipTap editor + FieldInput NodeView]
                  └─ edit branch shows text state badge toggle
                     (clicks cycle optional → mandatory → hr → optional;
                      'hr' leg is a no-op until AHR-1642 wires full mgmt)
```

**What AHR-1642+ inherits:**

- `App_FieldRenderer` is feature-complete as a primitive; consumer T2s only pass props.
- `App_FieldLegendChip` is auto-included anywhere `App_ContractFiller` renders; individual surfaces only need to add it separately if they render fill cards outside the composite.
- `FieldRendererContext.onToggleState` is the hook for full 3-state toggle — AHR-1642 will replace the FormBuilderModal bridge with real `hr_field_keys` mutation + mandatory exclusivity enforcement.
- The version history restore flow (AHR-1558) already carries `hr_field_keys` through (AHR-1640 Phase C) — no additional wiring needed here.

---

## Plane IDs (populated by /pp)

Phase A: AHR-1673
- Task 1: AHR-1674
- Task 2: AHR-1675
- Task 3: AHR-1676
- Task 4: AHR-1677
- Task 5: AHR-1678
- Task 6: AHR-1679
- Task 7: AHR-1680
- Task 8: AHR-1681
- Task 9: AHR-1682

Phase B: AHR-1683
- Task 1: AHR-1684
- Task 2: AHR-1685
- Task 3: AHR-1686
- Task 4: AHR-1687

Phase C: AHR-1688
- Task 1: AHR-1689
- Task 2: AHR-1690
- Task 3: AHR-1691
- Task 4: AHR-1692
- Task 5: AHR-1693

Phase D: AHR-1694
- Task 1: AHR-1695
- Task 2: AHR-1696
- Task 3: AHR-1697
- Task 4: AHR-1698
- Task 5: AHR-1699
- Task 6: AHR-1700
- Task 7: AHR-1702

Phase E: AHR-1703
- Task 1: AHR-1704
- Task 2: AHR-1706
- Task 3: AHR-1708
- Task 4: AHR-1710
- Task 5: AHR-1712
- Task 6: AHR-1714
- Task 7: AHR-1716

Phase F: AHR-1717
- Task 1: AHR-1718
- Task 2: AHR-1719
- Task 3: AHR-1720
- Task 4: AHR-1721
- Task 5: AHR-1722
- Task 6: AHR-1723

Phase G: AHR-1724
- Task 1: AHR-1725
- Task 2: AHR-1726
- Task 3: AHR-1727

Phase H: AHR-1728
- Task 1: AHR-1729
