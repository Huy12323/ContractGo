# Onboarding wizard entity selection

> Version: [Outline](https://outline.jimbui.dev/doc/e4768e32-72fc-4539-9d38-9d5547160291) | Tier 1: [AHR-1966](https://plane.jimbui.dev/aiur/browse/AHR-1966/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)

## Requirements

- Wizard steps restructured: Step 0 = Email + Entity, Step 1 = Template + Pre-fill, Step 2 = Review + Send
- Entity selection required in Step 0 before proceeding
- Same email can be onboarded to different entities within the same org
- Same email to the same entity is blocked (duplicate check scoped to entity_id)
- `onboarding_invitations.entity_id` becomes NOT NULL (revert AHR-1173 nullable change)
- On approval, employee record created with the invitation's `entity_id`
- Existing in-flight invitations (entity_id NULL) backfilled to org's first entity

## Scope boundaries

- Contract templates remain org-scoped (not entity-scoped) — entity-scoped templates are a future concern
- Dynamic columns migration is AHR-1968 — this T2 only touches the wizard and edge functions
- No changes to the employee filler page or contract review flow — only the wizard send + approval endpoints

## Decisions

- **Decision:** Wizard steps restructured: Email + Entity first, then Template + Pre-fill, then Review + Send
  **Rationale:** Entity must be chosen before template (templates may become entity-scoped later). Email + entity together enables immediate duplicate validation.
- **Decision:** `entity_id` reverted to NOT NULL on `onboarding_invitations`. Existing NULLs backfilled.
  **Rationale:** Entity is required for employee creation (AHR-1967). Invitation carries entity_id through to approval.
- **Decision:** Duplicate checks scoped to `entity_id` instead of `organization_id`
  **Rationale:** Same person at different entities = separate employment records. Only same email + same entity is a true duplicate.
- **Decision:** `approve-contract` passes `invitation.entity_id` into employee insert
  **Rationale:** Fixes NOT NULL breakage from AHR-1967.
- **Decision:** `contract_templates` scoped to entity (entity_id added, migration + all consumers updated)
  **Rationale:** Templates reference entity-specific columns. Org-scoped templates don't make sense when columns differ per entity.
- **Decision:** `approve-content` edge function also fixed (entity_id passthrough + per-entity dynamic table)
  **Rationale:** Audit found identical org-scoped patterns in the content approval path.

Original Estimate: 5 points

## Implementation

### Phase A — Migration: onboarding_invitations entity_id NOT NULL

Backfill existing NULL entity_id values and restore the NOT NULL constraint.

- [x] Create migration file `YYYYMMDDHHMMSS_ahr1969_invitations_entity_id_not_null.sql`
- [x] Backfill: `UPDATE onboarding_invitations SET entity_id = (SELECT id FROM entities WHERE organization_id = onboarding_invitations.organization_id ORDER BY created_at ASC LIMIT 1) WHERE entity_id IS NULL`
- [x] `ALTER TABLE onboarding_invitations ALTER COLUMN entity_id SET NOT NULL`
- [x] Apply migration: `pnpm sb:dev:push`

### Phase B — Edge function: send-invitation validation changes

Update `employee-onboarding_send-invitation/index.ts` to accept entity_id and scope duplicate checks to entity.

- [x] Add `entity_id` to required request body fields (alongside `organization_id`, `employee_email`, `contract_template_id`)
- [x] Validate `entity_id` exists and belongs to the given `organization_id`
- [x] Pass `entity_id` into the invitation insert statement (line ~238)
- [x] Change employee-by-user duplicate check (line ~135): `.eq("organization_id", organization_id)` → `.eq("entity_id", entity_id)`
- [x] Change employee-by-email duplicate check (line ~155): `.eq("organization_id", organization_id)` → `.eq("entity_id", entity_id)`
- [x] Change invitation duplicate check (line ~173): `.eq("organization_id", organization_id)` → `.eq("entity_id", entity_id)`
- [x] Update error messages to mention entity context (e.g., "already exists in this entity")

### Phase C — Edge function: approve-contract entity_id passthrough

Update `employee-onboarding_approve-contract/index.ts` to pass entity_id from invitation to employee insert.

- [x] Ensure invitation select query includes `entity_id` in the select columns
- [x] Add `entity_id: invitation.entity_id` to the `employeeInsert` object (line ~286)
- [x] Remove explicit `organization_id` from `employeeInsert` — trigger now handles it via `set_org_id_from_entity()`

### Phase D — FE: Wizard step restructure

Restructure `App_OnboardingWizardModal.tsx` to move email + add entity to Step 0.

- [x] Update STEPS array: `['Email & Entity', 'Contract & Pre-fill', 'Review & Send']`
- [x] Add `selectedEntityId` state (`useState<string | null>(null)`)
- [x] Add entity query: fetch entities for current org (`supabase.from('entities').select('id, name, timezone').eq('organization_id', organizationId)`)
- [x] Step 0 content: Email input (moved from step 2) + Entity Select dropdown (required)
- [x] Step 0 canProceed: `isValidEmail && !!selectedEntityId`
- [x] Step 1 content: Template selection + pre-fill fields (merged from old steps 0+1)
- [x] Step 1 canProceed: `!!selectedTemplateId` (HR-fill gate remains on Next click)
- [x] Step 2 content: Review summary (template name, email, entity name, prefilled count) + Send button
- [x] Pass `entity_id: selectedEntityId` through to `mSend.mutation.mutate()` and the orchestrated path's `supabase.functions.invoke()` call
- [x] Add `selectedEntityId` to `handleReset` cleanup
- [x] Regenerate types if needed: `pnpm sb:dev:types`

## Context

_Stripped at /pp push time._

Non-tech: The onboarding wizard gains entity selection so each employee is onboarded to a specific business entity. Same person can be onboarded to multiple entities (different offices/branches) within one org — each creates an independent employment record.
Tech: Wizard at `src/components/employees/App_OnboardingWizardModal.tsx`. Edge functions at `supabase/functions/employee-onboarding_send-invitation/index.ts` and `employee-onboarding_approve-contract/index.ts`. Invitation table already has `entity_id` column (nullable since AHR-1173). Duplicate validation in send-invitation at lines 118-186.
Related: [Employee Onboarding](https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b) - onboarding spec
Siblings: 3 total, 1 Done (local) — [AHR-1967 Employees entity_id (Done local, pending /pp), AHR-1968 Dynamic columns migration (Todo)]
Execution Order: Step 2 of 2 — AHR-1967 done (local) ✓
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
