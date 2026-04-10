# [v0.0.1 | Employee Onboarding] Employee contract signing flow > Schema: renames + invitations

Work Item: [AHR-494](https://plane.jimbui.dev/aiur/browse/AHR-494/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (Todo)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Contract templates + contracts schema needs renaming from generic "onboarding forms" to reflect the contract composer model. New invitations table enables HR to send onboarding links before employee accounts exist.
Tech: `onboarding_forms` table (migration 20260408064426), `employee_contracts` table (migration 20260409044943 + 20260409045356), 4 frontend hooks (useM_OnboardingForm_*, useQ_Tables_OnboardingForms), `is_admin_or_owner` RLS pattern, `entities` table (FK target for invitations)
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — employee_columns, employees table (FK target)
Siblings: 5 total, 0 Done — [AHR-494 Schema (Not started), AHR-495 HR sends invitation (Not started), AHR-496 Employee accepts + fills (Not started), AHR-497 HR reviews + approves (Not started), AHR-498 PDF generation (Not started)]
Execution Order: Step 1 of 5 — no prerequisites (foundation)

## Phase A: Rename tables + update schema

- [x] Rename `onboarding_forms` → `contract_templates`: table, unique constraint (`onboarding_forms_unique_name_per_org`), index (`idx_onboarding_forms_organization_id`), 4 RLS policies
- [x] Rename `employee_contracts` → `contracts`: table, 4 indexes (`idx_employee_contracts_*`), signed_by FK constraint + index, 4 RLS policies
- [x] Replace `employee_contracts_status_enum` → `contracts_status_enum` with values: draft, sent, filled, active, voided
- [x] Add columns to `contracts`: `approved_by` (UUID FK → profiles ON DELETE SET NULL), `approved_at` (TIMESTAMPTZ), `prefilled_fields` (JSONB NOT NULL DEFAULT '{}')
- [x] Update form deletion trigger: rename function `handle_form_deletion_contracts` + trigger to reference `contract_templates`/`contracts`

## Phase B: Create invitation tables

- [x] Create `onboarding_invitations_status_enum` (sent, accepted, expired, revoked)
- [x] Create `onboarding_invitations` table: id (generate_id('obi')), organization_id (FK → organizations CASCADE), employee_email (TEXT NOT NULL), entity_id (FK → entities CASCADE), contract_template_id (FK → contract_templates CASCADE), prefilled_fields (JSONB DEFAULT '{}'), invitation_token (TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text), status (enum DEFAULT 'sent'), sent_by (UUID FK → profiles SET NULL), created_at, updated_at
- [x] Indexes + RLS for `onboarding_invitations` (admin/owner CRUD; employee SELECT deferred to AHR-496)
- [x] Create `rel__department__invitation` junction table: invitation_id (FK → onboarding_invitations CASCADE), department_id (FK → departments CASCADE), composite PK, created_at — no organization_id (derives via invitation FK)
- [x] RLS for junction table (derives org access via invitation parent)

## Phase C: Frontend alignment

- [x] Rename hook files: `useM_OnboardingForm_Create/Update/Delete` → `useM_ContractTemplate_Create/Update/Delete`, `useQ_Tables_OnboardingForms` → `useQ_Tables_ContractTemplates`
- [x] Update table name references inside renamed hooks (`onboarding_forms` → `contract_templates`)
- [x] Update `queryKeys.ts` entries for renamed tables
- [x] Regenerate TypeScript types (`pnpm sb:dev:types`)

## Phase D: Cleanup (added during AHR-495 review)

- [x] Replace `qTemplates.forms` with `qTemplates.templates` in `App_OnboardingFormsList.tsx` (3 refs) and `App_FormBuilderModal.tsx` (2 refs) — missed during Phase C, caused runtime crash on View Forms

---

## Plane IDs (populated by /pp)

Phase A: AHR-504

- Task 1: AHR-505
- Task 2: AHR-506
- Task 3: AHR-507
- Task 4: AHR-508
- Task 5: AHR-509

Phase B: AHR-510

- Task 1: AHR-511
- Task 2: AHR-512
- Task 3: AHR-513
- Task 4: AHR-514
- Task 5: AHR-515

Phase C: AHR-516

- Task 1: AHR-517
- Task 2: AHR-518
- Task 3: AHR-519
- Task 4: AHR-520

Phase D: AHR-537 (cleanup — added during AHR-495 review)

- Task 1: AHR-538
