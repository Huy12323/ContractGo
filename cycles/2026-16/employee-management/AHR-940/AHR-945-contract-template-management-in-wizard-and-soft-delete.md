# Contract template management in onboarding wizard + soft delete

Work Item: [AHR-945](https://plane.jimbui.dev/aiur/browse/AHR-945/)
Tier 1: [AHR-940](https://plane.jimbui.dev/aiur/browse/AHR-940/) [v0.0.1 | Employee Management] Table view UX overhaul — auto-save, field composer, drag-order columns (Todo)
Module: Employee Management ([Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/3fd67ea1-f53b-40dc-9382-ee2bc8234f58/))
Outline Spec: https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd
Version Doc: https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802

## Context (from spec)

Non-tech: Consolidate all contract template management (create / pick / edit / archive) into step 2 of the onboarding wizard. Add a search filter and a "+ Create" button to the existing template picker; show hover-only Edit and Archive actions on each template card. Convert hard-delete of templates to soft-delete (`is_archived BOOLEAN`) so existing onboarding invitations don't break when admins remove unused templates. Drop the standalone "View Forms" button + modal from the Employees page header.

Tech: Schema migration adds `is_archived BOOLEAN NOT NULL DEFAULT false` to `contract_templates`. `useM_ContractTemplate_Delete` is renamed to `useM_ContractTemplate_Archive` and switches from `.delete()` to `.update({ is_archived: true })`. `useQ_Tables_ContractTemplates` adds `.eq('is_archived', false)` to default-hide archived rows from all consumers. Wizard step 2 in `App_OnboardingWizardModal.tsx` (line 224 area) is enhanced with search + create + per-row hover actions. `App_OnboardingFormsList` and `App_ViewFormsModal` are deleted (their functionality is now inline in wizard step 2). The "View Forms" button + state in `Page_Employees.tsx` are removed. Form button styling: `size="small"` is dropped from the relocated Create button. Tables: `contract_templates`. Files: migration; `useM_ContractTemplate_Archive.ts` (renamed); `useQ_Tables_ContractTemplates.ts`; `App_OnboardingWizardModal.tsx`; `Page_Employees.tsx`; deletions of `App_OnboardingFormsList.tsx` + `App_ViewFormsModal.tsx`.

Related: Employee Onboarding ([Outline](https://outline.jimbui.dev/doc/53541ea5-a12b-4aae-bef4-ba9644af2802)) — wizard step 2 is the touch surface; filler page (`Page_OnboardingFiller`) and invitation queries (`useQ_Tables_OrgOnboardingInvitations`, `useQ_Tables_MyOnboardingInvitations`) read templates by FK and are unaffected by the soft-delete shift.

Siblings: 6 total, 0 Done — AHR-941 Auto-save + toolbar (planned local), AHR-942 Empty-state (Not started), AHR-943 Field composer + single_select (planned local), AHR-944 Column controls (Not started), AHR-945 (this, planned local), AHR-946 Sidebar polish (Not started).

Execution Order: Step 1 of 3 — all done ✓ (no prerequisites; parallel with AHR-941 + AHR-943).

## Phase A: Soft delete migration

- [x] Create migration `2026XXXXXXXXXX_ahr945_contract_templates_is_archived.sql`
- [x] `ALTER TABLE public.contract_templates ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;`
- [x] (Optional) `CREATE INDEX idx_contract_templates_is_archived ON public.contract_templates(organization_id, is_archived) WHERE is_archived = false;` — small partial index for the active-templates lookup
- [x] Apply migration via Supabase CLI per `bible-supabase-cli`
- [x] Regenerate types via `pnpm sb:dev:types`
- [x] Verify `Tables<'contract_templates'>` row type includes `is_archived: boolean`

## Phase B: Hook updates

- [x] Rename `frontend/vite/src/hooks/useM_ContractTemplate_Delete.ts` → `useM_ContractTemplate_Archive.ts`
- [x] Update export name `useM_ContractTemplate_Delete` → `useM_ContractTemplate_Archive` (and `UseM_ContractTemplate_Delete_Params` → `UseM_ContractTemplate_Archive_Params`)
- [x] Replace `.delete().eq('id', templateId)` with `.update({ is_archived: true }).eq('id', templateId)`
- [x] Change `mutationKey` from `["contractTemplates", "delete", ...]` to `["contractTemplates", "archive", ...]`
- [x] Change toast: `message.success("Template archived")` (was "Template deleted")
- [x] Edit `useQ_Tables_ContractTemplates.ts`: add `.eq('is_archived', false)` to the SELECT chain (after `.eq('organization_id', ...)`)
- [x] Find all call sites of the old hook name and update imports + usage (likely `App_OnboardingFormsList.tsx` — but that's being deleted, so ensure the wizard's new archive path uses the renamed hook)

## Phase C: Wizard step 2 redesign

- [x] Edit `App_OnboardingWizardModal.tsx` step 2 block (line 221-258 area)
- [x] Add a top row above the template list: `Input` (placeholder "Search templates", `prefix={<SearchOutlined />}`, `allowClear`) + spacer + `Button type="primary" icon={<PlusOutlined />}` ("Create template" or just `+`)
- [x] Wire search to local `templateSearch` state; filter `qTemplates.templates` client-side by name (case-insensitive includes)
- [x] `+` button opens `App_FormBuilderModal` in CREATE mode (`templateId={null}`)
- [x] Each template card gets hover-only action group on the right: pencil icon (Edit → opens `App_FormBuilderModal` in EDIT mode with `templateId={t.id}`) + trash icon (Archive → confirmation modal then `useM_ContractTemplate_Archive`)
- [x] Replace the existing empty-state (line 227-231 — "Create one via 'View Forms' first.") with a centered `<Empty>` + primary "Create your first template" button that opens form builder in CREATE mode
- [x] Add local state: `[builderOpen, setBuilderOpen]`, `[editingTemplateId, setEditingTemplateId]`, `[templateSearch, setTemplateSearch]`
- [x] Mount `<App_FormBuilderModal open={builderOpen} onClose={() => { setBuilderOpen(false); setEditingTemplateId(null) }} organizationId={organizationId} formId={editingTemplateId} />` as a sibling at the bottom of the wizard's return (peer of the wizard `<Modal>`)
- [x] After form builder closes successfully on CREATE, optionally pre-select the newly created template in the picker (capture id from form builder's create callback if it exposes one)

## Phase D: Cleanup — delete old surfaces

- [x] Delete `frontend/vite/src/components/employees/App_OnboardingFormsList.tsx`
- [x] Delete `frontend/vite/src/components/employees/App_ViewFormsModal.tsx`
- [x] Edit `Page_Employees.tsx`: remove `App_ViewFormsModal` import (line 26), remove `viewFormsOpen` state (line 56), remove the "View Forms" button (around line 316), remove the modal mount (line 524)
- [x] Verify nothing else imports the deleted components — grep before commit

## Phase E: Form button styling

- [x] In `App_OnboardingWizardModal.tsx` step 2 (the new `+` button + the empty-state "Create your first template" button) — both use default-size primary `Button` with global ANTD theme tokens; no `size="small"`, no inline `borderRadius` overrides
- [x] Confirm visual consistency with surrounding wizard step 2 elements (Select, Input, etc.)

---

## Plane IDs (populated by /pp)

Phase A: (pending)
- Migration creation: (pending)
- Apply locally: (pending)
- Regenerate types: (pending)

Phase B: (pending)
- Rename hook file + export: (pending)
- Switch delete → update is_archived: (pending)
- Toast change: (pending)
- Query filter is_archived = false: (pending)
- Update call sites: (pending)

Phase C: (pending)
- Wizard step 2 search + create row: (pending)
- Per-row hover actions Edit + Archive: (pending)
- Empty state revamp: (pending)
- Form builder modal mount inside wizard: (pending)

Phase D: (pending)
- Delete App_OnboardingFormsList: (pending)
- Delete App_ViewFormsModal: (pending)
- Remove Page_Employees View Forms button: (pending)

Phase E: (pending)
- Drop size="small": (pending)
- Verify visual consistency: (pending)
