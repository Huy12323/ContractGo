# [v0.0.1 | Employee Onboarding] Employee contract signing flow > Employee accepts + fills contract

Work Item: [AHR-496](https://plane.jimbui.dev/aiur/browse/AHR-496/)
Tier 1: [AHR-465] [v0.0.1 | Employee Onboarding] Employee contract signing flow (In Progress)
Module: [Employee Onboarding](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Employee receives an onboarding email with a link, lands on the contract filler, completes the remaining fields (pre-fills are locked read-only), draws or uploads a signature, and submits. The contract lands in "filled" status awaiting HR approval. The same invitations are also surfaced on the employee's home page below the org list as a secondary entry point.
Tech: `onboarding_invitations` (AHR-494) + `rel__department__invitation`, `contracts` table (needs `employee_id` → nullable + SELECT policy update), `App_ContractFiller` + `App_ContractPreview` (reused from AHR-495), `org-files` storage bucket (service_role upload via edge function), `Page_Home` (add `PageHome_OnboardingInvitations` subcomponent), `_protected` layout route (auth + email verified guard).
Related: [Employee Management](https://outline.jimbui.dev/doc/1d8b194f-f7e9-4059-8448-2c899d5deacd) — `employees` row is NOT created in this T2 (deferred to AHR-497 approval); `employee_columns` + choices feed `App_ContractFiller`.
Siblings: 5 total, 2 Done — [AHR-494 Schema (Done), AHR-495 HR sends invitation (Done local, pending /pp), AHR-496 Employee accepts + fills (Todo) ←, AHR-497 HR reviews + approves (Todo), AHR-498 PDF generation (Todo)]
Execution Order: Step 3 of 5 — Steps 1 (AHR-494) and 2 (AHR-495) effectively Done ✓

## Phase A: Backend — schema, RLS, submit edge function

- [x] Migration: drop `NOT NULL` on `contracts.employee_id`; update `admin_or_self_can_view_contracts` RLS policy to add `OR signed_by = (SELECT auth.uid())` branch so employees can read their own filled-but-unapproved contracts
- [x] Migration: add employee-facing SELECT policy on `onboarding_invitations` — `lower(employee_email) = lower(auth.jwt() ->> 'email') AND status = 'sent'` (mirrors `admin_invitations` invitee policy pattern)
- [x] Migration: add employee-facing SELECT policy on `rel__department__invitation` — allows reading rows for invitations the caller matches via email (needed so the filler page can display department context if we want to show it; optional — include only if filler UI surfaces departments)
- [x] Create `employee-onboarding_submit-contract` Edge Function + `deno.json` — auth caller, resolve invitation by token, verify `lower(user.email) === lower(invitation.employee_email)`, verify `invitation.status === 'sent'`, fetch `contract_template.layout`, decode signature base64 PNG, upload to `org-files/{org_id}/contracts/{contract_id}/signature.png` via service_role, insert `contracts` row (`employee_id=NULL`, `form_snapshot=template.layout`, `field_values`, `prefilled_fields=invitation.prefilled_fields`, `signature_path`, `signed_by=user.id`, `signed_at=now()`, `signer_ip=req.headers['x-forwarded-for']`, `status='filled'`), update `onboarding_invitations.status='accepted'`, return `{contract_id, status}`. Rollback signature upload + insert on any failure.

## Phase B: Frontend data layer — hooks + query keys

- [x] Add `onboardingInvitations.mine()` and `onboardingInvitations.byToken(token)` entries to `queryKeys.ts`
- [x] Create `useQ_Tables_MyOnboardingInvitations` — queries `onboarding_invitations` joined with `organizations(id, name)`, `entities(id, name)`, `contract_templates(id, name)`, filtered by `status='sent'` (RLS auto-filters by email). Returns list for Page_Home
- [x] Create `useQ_PageOnboardingFiller_InvitationByToken` — takes `invitationToken` param, queries single invitation joined with template (id, name, layout), entity (id, name), org (id, name). RLS enforces email match
- [x] Create `useM_Onboarding_SubmitContract` hook — calls `employee-onboarding_submit-contract` edge function via `supabase.functions.invoke`, body `{invitation_token, field_values, signature_base64}`; invalidates `QueryKeys.onboardingInvitations.all()` on success

## Phase C: Signature capture component

- [x] Install `react-signature-canvas` + `@types/react-signature-canvas` in `frontend/vite` workspace
- [x] Create `App_SignaturePad` — tabs or segmented control for "Draw" | "Upload". Draw mode uses `SignatureCanvas` with clear + undo buttons, sized via ANTD theme tokens. Upload mode uses ANTD `Upload.Dragger` accepting a single PNG/JPG. Both modes emit a base64 PNG dataURL via `onChange(dataUrl | null)` prop. Display current preview + "Clear" action when a signature is set.

## Phase D: Filler page + route

- [x] Create route `src/routes/_protected/onboarding/$invitationToken.tsx` — extracts param via `useParams({ from })`, uses the loader/data via `useQ_PageOnboardingFiller_InvitationByToken`, renders `Page_OnboardingFiller`. Relies on `_protected` layout's existing auth + email verification guards; no additional guard needed because RLS on the invitation query fails for non-matching emails (page shows not-found state)
- [x] Create `src/pages/Page_OnboardingFiller/Page_OnboardingFiller.tsx` — layout: header (org name + "Welcome, sign your contract"), main pane splits `App_ContractFiller` (flex:1) with `App_SignaturePad` in a right-hand drawer or below. Tracks local state for `fieldValues` (initialized from `invitation.prefilled_fields`), `signatureDataUrl`. Passes `prefilled_fields` as lock-out set so `App_ContractFiller` shows prefilled keys as read-only
- [x] Extend `App_ContractFiller` — accept optional `readOnlyKeys: Set<string>` (or `lockedFields`) prop. When a fieldKey is in the set, render its `FieldControl` with `disabled` prop + distinct visual treatment via theme tokens (e.g., `colorFillTertiary` background). Default to fully editable when prop omitted so AHR-495's HR pre-fill flow is unaffected
- [x] Submit flow in `Page_OnboardingFiller` — validate: every non-prefilled field has a value (use `extractFields(layout)` from `App_ContractFiller`) and signature is present. On click, call `mSubmitContract.mutateAsync({invitation_token, field_values, signature_base64: signatureDataUrl})`. On success, show ANTD success message and navigate to `/` (Page_Home). Empty/error states: invitation not found, already accepted, network failure
- [x] Add `ext_TipTap` lockout visual — not needed in practice: TipTap nodes already render values via `editor.storage.fieldInput.values`, which is fed by `mergedValues` (prefilled merged with employee input). The employee never interacts with the inline node directly — all input happens through the side panel, where locked keys are disabled. Inline rendering is consistent regardless of lock status, so no extension change required.

## Phase E: Home page "Pending Invitations" section

- [x] Create `PageHome_OnboardingInvitations` subcomponent at `src/pages/Page_Home/PageHome_OnboardingInvitations/PageHome_OnboardingInvitations.tsx` — renders a list card (same bordered-container style as the org list) with rows showing org name + entity name + template name + "Fill Contract" button. Button navigates via `Link` to `/onboarding/{invitationToken}`. Returns `null` when list is empty
- [x] Integrate into `Page_Home.tsx` — call `useQ_Tables_MyOnboardingInvitations`, render `PageHome_OnboardingInvitations` below the existing org-list container with a `Title level={4}` "Pending Invitations" heading. Section is conditionally rendered (only when `qInvitations.invitations.length > 0`), works whether the user has zero orgs (brand-new signup) or existing orgs

## Phase F: Post-testing fixes — invitee data access + filler UX polish

- [x] Migration `20260410065009_ahr496_invitee_rls_joined_tables.sql` — add six invitee-facing SELECT RLS policies, all scoped to "the caller has an active onboarding invitation referencing this row". Tables: `organizations` (org name in header), `entities` (entity name in header), `contract_templates` (template layout — without this the TipTap preview is empty), `departments` (junction-derived dept names in tag row), `employee_columns` (column metadata for `App_ContractFiller` field rendering), `employee_column_choices` (multi_select options). Each policy uses `id IN (SELECT ... FROM onboarding_invitations WHERE status = 'sent' AND lower(employee_email) = lower(auth.jwt() ->> 'email'))` (departments goes one hop through `rel__department__invitation`). Root cause: the original AHR-496 implementation assumed RLS would just work for joined tables, but the invitee is authenticated yet NOT a member of the org (no `admins`/`employees` row), so admin-only and org-member-only SELECT policies returned empty joins and the filler UI rendered nothing.
- [x] `Page_OnboardingFiller.CenteredMessage` style alignment with `_auth` layout — wrap the wrong-account and not-available error states in the same gradient background + 420px floating card treatment that `routes/_auth/route.tsx` uses to wrap admin invitation pages. Same gradient stops, same `boxShadow`, same `borderRadiusLG`, same border + padding values — copied directly from `_auth/route.tsx` so they stay in sync visually. Without this wrapper, the error states rendered as flat content inside the `_protected` app shell and looked nothing like the admin invitation's "different account needed" screen, even though the inner content (icon + title + body + buttons) had matched since the original AHR-496 implementation.

---

## Plane IDs (populated by /pp)

Phase A: AHR-578

- Task 1: AHR-584
- Task 2: AHR-585
- Task 3: AHR-586
- Task 4: AHR-587

Phase B: AHR-579

- Task 1: AHR-588
- Task 2: AHR-589
- Task 3: AHR-590
- Task 4: AHR-591

Phase C: AHR-580

- Task 1: AHR-592
- Task 2: AHR-593

Phase D: AHR-581

- Task 1: AHR-594
- Task 2: AHR-595
- Task 3: AHR-596
- Task 4: AHR-597
- Task 5: AHR-598

Phase E: AHR-582

- Task 1: AHR-599
- Task 2: AHR-600

Phase F: AHR-583

- Task 1: AHR-601
- Task 2: AHR-602
