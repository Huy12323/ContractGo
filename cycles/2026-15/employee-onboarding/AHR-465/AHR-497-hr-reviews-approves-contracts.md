# [v0.0.1 | Employee Onboarding] Employee contract signing flow > HR reviews + approves contracts

Work Item: [AHR-497](https://plane.jimbui.dev/aiur/browse/AHR-497/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Repurpose the Onboard Employee toolbar button on Page_Employees into an Onboarding hub — clicking it opens a modal that lists every onboarding invitation in the org grouped by status (Sent / Needs Approval / Active). HR clicks a "Needs Approval" item to see the rendered contract + signature, fills in the employee's first/last name (and optional birthday), and approves. Approval atomically creates the employees row, marks the contract active, and assigns the new employee to the departments selected on the original invitation. The original 4-step send-invitation wizard is still reachable via an "Onboard Employee" button inside the new list modal.
Tech: `contracts` (new `invitation_id` FK), `onboarding_invitations_status_enum` (new `approved` value), `employees` (insert path with `user_id` from `contract.signed_by`, `email` from invitation, names from HR input, `col_*` from `field_values`), `rel__department__invitation` → `rel__department__employee` copy, `employee-onboarding_approve-contract` Edge Function (service_role with admin/owner gate), `employee-onboarding_submit-contract` (one-line patch to record `invitation_id`), `App_OnboardingModal` (full rewrite — list view), `App_OnboardingWizardModal` (renamed from current `App_OnboardingModal`), `App_OnboardingReviewModal` (new), `App_ContractPreview` (reused), `org-files` storage signed URL for signature image.
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — `employees` insert path is created here for the first time; dynamic `col_*` values flow from contract field_values into matching employees columns.
Siblings: 6 total, 4 effectively Done — [AHR-494 Schema (Done), AHR-495 HR sends invitation (Done), AHR-496 Employee accepts + fills (Done local, pending /pp), AHR-497 HR reviews + approves (Todo) ←, AHR-498 PDF generation (Todo), AHR-539 Bug fixes + prevention (Done)]
Execution Order: Step 4 of 5 — Steps 1-3 (AHR-494, AHR-495, AHR-496) all effectively Done ✓

## Phase A: Schema — contract↔invitation linkage + new enum value

- [x] Migration `20260410081933_ahr497_contracts_invitation_id.sql` — `ALTER TABLE public.contracts ADD COLUMN invitation_id TEXT REFERENCES public.onboarding_invitations(id) ON DELETE SET NULL;` + `CREATE INDEX idx_contracts_invitation_id ON public.contracts(invitation_id);`
- [x] Migration `20260410081934_ahr497_invitation_status_approved.sql` — `ALTER TYPE public.onboarding_invitations_status_enum ADD VALUE 'approved';` (separate file because Postgres requires `ADD VALUE` outside a multi-statement transaction with prior DDL)
- [x] Update `frontend/vite/supabase/functions/employee-onboarding_submit-contract/index.ts` — set `invitation_id: invitation.id` in the contracts insert payload (one-line addition around line 130)
- [x] Apply migrations locally (`npx supabase db push --local`), run `supabase db lint --local`, regenerate types (`npx supabase gen types typescript --local > src/types/database.types.ts`). Pre-existing lint warnings on `public.authorize` (references dropped `org_admins`) are unrelated to this T2.

## Phase B: Backend — Approval edge function

- [x] Create `frontend/vite/supabase/functions/employee-onboarding_approve-contract/{index.ts, deno.json}` — Deno runtime, `supabase` import map, CORS headers, `requireEnv` helper for `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- [x] Auth: build user-scoped client with caller's `Authorization` header → `auth.getUser()`; build separate service-role client for writes; canonical owner-or-admin check (lookup `organizations.owner_id` first, fall back to `admins.maybeSingle()`) — pattern from `employee-management_create-column/index.ts:81-102`. Return 403 if neither
- [x] Request body: `{ contract_id: string, first_name: string, last_name: string, birthday?: string }`. Validate `contract_id`, `first_name`, `last_name` are non-empty
- [x] Resolve contract via service-role: `select id, organization_id, status, invitation_id, signed_by, field_values, prefilled_fields, contract_template_id`. Verify `status === 'filled'` and `invitation_id IS NOT NULL`; verify caller is admin/owner of `contract.organization_id`
- [x] Resolve invitation via `contract.invitation_id`: `select id, organization_id, employee_email, status`. Verify `invitation.organization_id === contract.organization_id` and `invitation.status === 'accepted'`
- [x] Build employees insert payload: `organization_id` from invitation, `user_id` from `contract.signed_by` (the employee's auth.uid), `email` from `invitation.employee_email`, `first_name`/`last_name` from request body, `birthday` from request body or `'0001-01-01'` fallback. Walk merged values (`{...prefilled_fields, ...field_values}`) and copy through any key matching `^col_[A-Za-z0-9]+$` as additional Insert columns (employee_columns ids = literal employees columns)
- [x] Insert `employees` row → capture `new_employee.id`. Rollback strategy below if any later step fails
- [x] Update `contracts` row: `employee_id = new_employee.id`, `approved_by = caller.user.id`, `approved_at = now().toISOString()`, `status = 'active'`. On error → delete the freshly-inserted employee row + return 500
- [x] Fetch `rel__department__invitation` rows for `invitation.id` → bulk insert into `rel__department__employee` as `[{ department_id, employee_id: new_employee.id }, ...]`. On error → revert contract update + delete employee row + return 500
- [x] Update `onboarding_invitations.status = 'approved'`. On error → log + return 207 (contract is active, only the invitation flag is stale)
- [x] Return `200 { employee_id, contract_id, status: 'active' }`

## Phase C: Frontend data layer — hooks + query keys

- [x] Add `QueryKeys.onboardingInvitations.org(orgId)` entry to `queryKeys.ts`
- [x] Add new `QueryKeys.contracts = { all: () => ['contracts'], list: () => [...all, 'list'], record: (id) => [...all, id] }` entry to `queryKeys.ts`
- [x] Create `frontend/vite/src/hooks/useQ_Tables_OrgOnboardingInvitations.ts` — fetches all org invitations with joined entity, template, departments via `rel__department__invitation`, and the `contracts` LEFT JOIN through `invitation_id`
- [x] Create `frontend/vite/src/hooks/useQ_Tables_Contract.ts` — fetches a single contract by id (heavy payload with `form_snapshot`, `field_values`, `prefilled_fields`, `signature_path`, audit fields)
- [x] Create `frontend/vite/src/hooks/useM_OnboardingInvitation_Approve.ts` — mutationFn invokes `employee-onboarding_approve-contract`; `onSuccess` invalidates `QueryKeys.onboardingInvitations.all()` and `QueryKeys.contracts.all()`

## Phase D: UI — Extract wizard, build new list modal, rename toolbar button

- [x] Rename `frontend/vite/src/components/employees/App_OnboardingModal.tsx` → `App_OnboardingWizardModal.tsx`; rename the exported `App_OnboardingModal` constant → `App_OnboardingWizardModal`. Internals stay identical. (Page_Employees import will be temporarily broken until the new file lands — fix in the same patch)
- [x] Create new `frontend/vite/src/components/employees/App_OnboardingModal.tsx`:
    - Props `{ open, onClose, organizationId }`
    - Calls `useQ_Tables_OrgOnboardingInvitations({ organizationId })`
    - `useMemo` three buckets: `sentList = invitations.filter(i => i.status === 'sent')`, `needsApprovalList = invitations.filter(i => i.status === 'accepted')`, `activeList = invitations.filter(i => i.status === 'approved')`
    - Header bar: title "Onboarding" + primary `<Button icon={<UserAddOutlined />} onClick={() => setWizardOpen(true)}>Onboard Employee</Button>`
    - `<Tabs defaultActiveKey="needsApproval">` with three items. Each tab label is `<span>{title} <Badge count={N} showZero={false} /></span>`. Order: Needs Approval, Sent, Active
    - Each tab body renders an ANTD `<List>` of bordered rows. Row content (per tab):
        - **Needs Approval:** template name, employee email, entity name, department tags, signed-at relative time. Whole row clickable → `setReviewContractId(inv.contracts[0].id)`. Right side: small "Review" `<Button>`
        - **Sent:** template name, employee email, entity name, department tags, "Awaiting employee response", sent-at relative time. No click handler
        - **Active:** template name, employee email, entity name, department tags, approved-at relative time. No click handler (detail view comes in a future T2 if needed)
    - Empty states per tab via ANTD `<Empty>` with appropriate descriptions
    - Local state `wizardOpen: boolean` and `reviewContractId: string | null`
    - Renders `<App_OnboardingWizardModal open={wizardOpen} onClose={() => setWizardOpen(false)} organizationId={organizationId} />` and `<App_OnboardingReviewModal open={!!reviewContractId} onClose={() => setReviewContractId(null)} contractId={reviewContractId} organizationId={organizationId} />`
    - All spacing/colors via `theme.useToken()` — no hardcoded values
- [x] Update `frontend/vite/src/pages/Page_Employees/Page_Employees.tsx`:
    - Replace `UserAddOutlined` import with `SolutionOutlined` from `@ant-design/icons` (verify `UserAddOutlined` is not used elsewhere on the page first; if it is, keep both imports)
    - Toolbar button at line ~289: change label "Onboard Employee" → "Onboarding", change icon prop → `<SolutionOutlined />`
    - Existing `<App_OnboardingModal>` consumer at line ~488 needs no prop changes — same component name, new internal behavior

## Phase E: UI — Review/approve modal

- [x] Create `frontend/vite/src/components/employees/App_OnboardingReviewModal.tsx`:
    - Props `{ open, onClose, contractId, organizationId }`
    - Calls `useQ_Tables_Contract({ contractId })` for the heavy contract payload
    - Resolves the signature image: `useEffect` (or inline `useState` + `useEffect`) that calls `supabase.storage.from('org-files').createSignedUrl(qContract.contract.signature_path, 300)` once `signature_path` is known. Store the signed URL in local state. Re-fetch when contract changes
    - Header title: "Review Contract"
    - Body two-column layout (`token.marginLG` gap):
        - Left column (`flex: 1`): `<App_ContractPreview layout={qContract.contract.form_snapshot} fieldValues={{ ...qContract.contract.prefilled_fields, ...qContract.contract.field_values }} columns={qColumns.columns} choices={qChoices.choices} />` — reuse the same ContractPreview shell as the wizard
        - Right column (`width: 320px` or similar): summary block (employee email from joined invitation in the list-modal scope OR re-fetch via separate query; entity, department tags) + signature image (`<img src={signedUrl} />` with bordered card via theme tokens) + `<Form layout="vertical">` with `first_name` (required), `last_name` (required), `birthday` (`<DatePicker />`, optional). Form values bound to local state
    - Footer: `<Button>Cancel</Button>` + primary `<Button type="primary" loading={mApprove.mutation.isPending}>Approve</Button>`. Approve handler validates required fields → calls `mApprove.mutation.mutate({ contract_id: contractId, first_name, last_name, birthday: birthday?.format('YYYY-MM-DD') }, { onSuccess: onClose })`
    - Empty / error states: contract not found (closed via `useEffect` redirect), signature URL fetch failure (show placeholder + warning Tag), HR not authorized (rare — caught by edge function 403)
    - Calls `useQ_Tables_EmployeeColumns` and `useQ_Tables_EmployeeColumnChoices` (same as wizard) so `App_ContractPreview` can render typed field values
    - All styling via `theme.useToken()`
- [x] Wire `<App_OnboardingReviewModal>` from `App_OnboardingModal` (already covered in Phase D); verify the modal closes cleanly and the list query refetches the affected invitation row

## Phase F: Verification

- [x] After Phase A migrations: regenerated types confirm `contracts.invitation_id: string | null` and `onboarding_invitations_status_enum` includes `'approved'`
- [x] Frontend `tsc --noEmit` clean for all AHR-497 files. The 4 remaining errors (`App_LoginForm`, `App_SignUpForm`, `main.tsx`, `_protected/route.tsx`) are pre-existing, unrelated to this T2
- [x] `supabase db lint --local` produces no new errors — only the pre-existing `public.authorize` → dropped `org_admins` reference
- [x] End-to-end manual flow: verified during the session — HR sends → employee fills + submits → Onboarding modal Needs Approval tab → click Review → fill first/last name → Approve → confirmed in Studio that employees row exists, contracts.status='active' + audit fields populated, rel__department__employee rows present, onboarding_invitations.status='approved'.
- [x] HR signature image rendering: verified — `org-files` storage admin/owner SELECT policy is in place, signed URL renders the signature PNG inside the Review modal correctly.

---

## Plane IDs (populated by /pp)

Phase A: AHR-603

- Task 1: AHR-609
- Task 2: AHR-610
- Task 3: AHR-611
- Task 4: AHR-612

Phase B: AHR-604

- Task 1: AHR-613
- Task 2: AHR-614
- Task 3: AHR-615
- Task 4: AHR-616
- Task 5: AHR-617
- Task 6: AHR-618
- Task 7: AHR-619
- Task 8: AHR-620
- Task 9: AHR-621
- Task 10: AHR-622

Phase C: AHR-605

- Task 1: AHR-623
- Task 2: AHR-624
- Task 3: AHR-625
- Task 4: AHR-626
- Task 5: AHR-627

Phase D: AHR-606

- Task 1: AHR-628
- Task 2: AHR-629
- Task 3: AHR-630

Phase E: AHR-607

- Task 1: AHR-631
- Task 2: AHR-632

Phase F: AHR-608

- Task 1: AHR-633
- Task 2: AHR-634
- Task 3: AHR-635
- Task 4: AHR-636
- Task 5: AHR-637
