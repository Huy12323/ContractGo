# [v0.0.1 | Employee Onboarding] Employee contract signing flow > HR sends onboarding invitation

Work Item: [AHR-495](https://plane.jimbui.dev/aiur/browse/AHR-495/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: HR sends onboarding invitations to new employees — a multi-step wizard where HR selects entity, departments, contract template, pre-fills some fields, enters employee email, and sends. Employee receives an email with a unique link to fill and sign their contract.
Tech: `onboarding_invitations` table (AHR-494), `rel__department__invitation` junction, `contract_templates` table, `App_FormBuilderModal` (TipTap editor + FieldInput extension), `shared--send-email` Edge Function (Resend), `send-admin-invitation` (pattern to follow), existing entity/department query hooks
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — employee_columns used as fillable fields in templates
Siblings: 5 total, 1 Done — [AHR-494 Schema (Done), AHR-495 HR sends invitation (Todo), AHR-496 Employee accepts + fills (Todo), AHR-497 HR reviews + approves (Todo), AHR-498 PDF generation (Todo)]
Execution Order: Step 2 of 5 — Step 1 (AHR-494) Done ✓

## Phase A: Backend — Edge function + email scenario

- [x] Create `employee-onboarding_send-invitation` Edge Function + `deno.json` — auth check (admin/owner), insert `onboarding_invitations` row (organization_id, employee_email, entity_id, contract_template_id, prefilled_fields, sent_by), insert `rel__department__invitation` rows for each department_id, call `shared--send-email` with `employee_onboarding_invitation` scenario, return invitation record
- [x] Add `employee_onboarding_invitation` scenario to `shared--send-email` — email template with organization name, sender name, and invitation link (`{APP_URL}/onboarding/{invitation_token}`)

## Phase B: Frontend data layer — hooks + query keys

- [x] Add `onboardingInvitations` entry to `queryKeys.ts` (all, list, record pattern)
- [x] Create `useM_OnboardingInvitation_Send` hook — calls edge function via `supabase.functions.invoke('employee-onboarding_send-invitation', { body })`, invalidates `QueryKeys.onboardingInvitations.all()` on success

## Phase C: Contract filler component

- [x] Create `App_ContractFiller` — renders TipTap JSONContent as read-only document, replaces FieldInput nodes with interactive ANTD form inputs (text, number, date, boolean, multi_select based on column type), tracks field values in state via `onChange` callback
- [x] Props: `layout` (JSONContent), `fieldValues` (Record<string, string>), `onChange` (fieldKey → value), `columns` (from useQ_Tables_EmployeeColumns), `choices` (from useQ_Tables_EmployeeColumnChoices)

## Phase D: Onboarding wizard modal + page integration

- [x] Create `App_OnboardingModal` shell — ANTD Modal + Steps component, 4 steps, Next/Back/Send navigation, state management for selections across steps
- [x] Step 1: Entity Select (ANTD Select) + Department Checkboxes (filtered by selected entity, using `useQ_Tables_OrgEntities` + `useQ_Tables_EntityDepartments`)
- [x] Step 2: Template Select (card list or Select from `useQ_Tables_ContractTemplates`, show template name + preview option)
- [x] Step 3: Pre-fill fields (render `App_ContractFiller` with selected template's layout, collect prefilled_fields)
- [x] Step 4: Email input (ANTD Input) + summary of selections (entity, departments, template, pre-filled count) + Send button (calls `useM_OnboardingInvitation_Send`)
- [x] Enable "Onboard Employee" button on `Page_Employees`, add `App_OnboardingModal` with open/close state

---

## Plane IDs (populated by /pp)

Phase A: AHR-521

- Task 1: AHR-522
- Task 2: AHR-523

Phase B: AHR-524

- Task 1: AHR-525
- Task 2: AHR-526

Phase C: AHR-527

- Task 1: AHR-528
- Task 2: AHR-529

Phase D: AHR-530

- Task 1: AHR-531
- Task 2: AHR-532
- Task 3: AHR-533
- Task 4: AHR-534
- Task 5: AHR-535
- Task 6: AHR-536
