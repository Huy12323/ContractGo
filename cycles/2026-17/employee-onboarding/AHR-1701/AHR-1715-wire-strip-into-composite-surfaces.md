# Wire strip into App_ContractFiller + inline body fallback

Work Item: AHR-1715 (https://plane.jimbui.dev/aiur/browse/AHR-1715/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: The `App_AttachmentStrip` component (AHR-1713) exists in isolation. This T2 wires it into every surface that renders a contract filler: form-builder composer preview, HR onboarding wizard pre-fill step, employee fill page, HR review modal, and the template versions peek modal. File-type fields disappear from the left "Pre-fill" column and appear as thumbnail cards in a strip above the TipTap preview on the right. In the contract body, file-type `{{field}}` placeholders render as italic `(see attachments)` text — the strip is the source of truth. HR can pre-fill attachments in the wizard; they're held client-side until the invitation is created on Send, at which point the send flow orchestrates upload + linkage.

Tech: Extends the file-upload system with a new `invitation_col` resource_type (files keyed by `invitation_id + column_id`) so employee fill + HR pre-fill + review can upload without an `employee_id` (which doesn't exist until post-submit `place-employee`). Edge functions `files_r2_upload-start`, `files_r2_sign-read-url`, `files_r2_delete` gain the new resource branch with dual auth (invitation recipient email match OR org admin/owner). The `useM_Files_Upload` + `useQ_Files_ReadUrl` hooks become discriminated unions by `resource_type`. `App_AttachmentStrip` + `App_ContractFiller` swap the single `employee_id` prop for an `uploadContext?: UploadContext` discriminated union with four kinds: `employee_col`, `invitation_col`, `defer` (hold File locally), and `undefined` (readonly). `App_ContractFiller` splits extracted fields into `fileFields` / `nonFileFields`; left column renders non-file fields as before, right column becomes a vertical flex with the strip on top and TipTap body below. `ext_TipTap_FieldInput` preview branch detects `fieldType === 'file'` and renders `(see attachments)` italic grey text. Wizard Send handler orchestrates draft invitation creation → parallel Files upload via `invitation_col` → PATCH invitation with resolved `prefilled_fields` → finalize send + email.

Related: `App_AttachmentStrip` (AHR-1713 — strip component this T2 wires up), `useM_Files_Upload` (extended in AHR-1711 with thumbnail emission; this T2 makes its params a discriminated union), `useQ_Files_ReadUrl` (extended in AHR-1711 with `use_thumbnail` flag; this T2 widens to a union), `useM_Files_Delete` (created in AHR-1713; edge function learns invitation-scoped auth here), `files_r2_upload-start` / `files_r2_sign-read-url` / `files_r2_delete` edge functions (invitation_col branch added here), `useM_OnboardingInvitation_Send` (Send flow extended with Files orchestration), `App_EmployeeDetailModal` + `AppEmployee_FilePreviewModal` (existing `useM_Files_Upload` / `useQ_Files_ReadUrl` callers — must adopt explicit `resource_type: 'employee_col'` after the shape change).

Siblings: 6 total, 5 Done (local, pending /pp) — AHR-1705 Schema (Done local), AHR-1707 Image utility (Done local), AHR-1709 Doc microservice (Cancelled), AHR-1711 Upload flow (Done local), AHR-1713 Strip component (Done local), AHR-1790 Grid thumbnails (Done local)

Execution Order: Step 5 of 5 — prereq AHR-1713 (strip component) effectively Done. Final step — after this T2 the T1 is fully implemented.

## Phase A: Edge function extension — `invitation_col` resource_type

- [x] `files_r2_upload-start/index.ts`: `"invitation_col"` added to `RESOURCE_TYPES`. New branch requires `{ invitation_id, column_id }`. R2 path: `orgs/{org_id}/invitations/{invitation_id}/{column_id}/{timestamp}-{uniqueId}-{sanitized}`. Auth: dual — recipient email match via `onboarding_invitations.employee_email` OR `isOrgAdminOrOwner`
- [x] `files_r2_sign-read-url/index.ts`: `invitation_col` branch added. Restructured `if/else` → `if/else if/else` for clarity. Same dual-auth rule. File's `organization_id` must match the invitation's
- [x] `files_r2_delete/index.ts`: scope-aware auth — parses `r2_key` prefix (`orgs/*/invitations/*/*`) to detect invitation-scoped files. Invitation files → dual auth; everything else → admin/owner (unchanged). Hook signature stays flat (just `{ file_id }`)
- [x] Inlined the dual-auth check in each edge function — comment at invocation site explains the rule. No shared module

## Phase B: Hook discriminated unions

- [x] `useM_Files_Upload.ts`: `UseM_Files_Upload_Params` is now a discriminated union (`employee_col` | `invitation_col`). `buildUploadStartBody` helper branches the edge-function body shape. Thumbnail generation path (`generateImageThumbnail`) threads the same params through so the thumb lands under the same scope
- [x] `useQ_Files_ReadUrl.ts`: matching discriminated union. QueryKey includes `resource_type` + `scope_id` (employee_id or invitation_id) so different scopes don't collide in cache
- [x] `useM_Files_Delete.ts`: unchanged. Edge function handles auth discrimination via r2_key prefix detection
- [x] Existing callers updated to pass explicit `resource_type: 'employee_col'`:
  - `App_EmployeeDetailModal.tsx` (replace flow `mFilesUpload.mutation.mutateAsync`)
  - `AppEmployee_FilePreviewModal.tsx` (`useQ_Files_ReadUrl` call)
  - `App_AttachmentStrip.tsx` (updated comprehensively in Phase C)

## Phase C: Strip + ContractFiller API rework — `uploadContext` + layout restructure

- [x] `UploadContext` type exported from `App_AttachmentStrip`: `{ kind: 'employee_col'; employee_id } | { kind: 'invitation_col'; invitation_id } | { kind: 'defer' }`. `undefined` = fully readonly
- [x] `App_AttachmentStrip` Props: `employee_id` → `uploadContext?: UploadContext`. `organization_id: string` stays
- [x] Card defer-mode: `value instanceof File` → "pending upload" pill (filename + "Pending upload" caption + file-type icon fallback + Remove that clears). On file pick in defer mode → `onChange(file)` with the File object; no network calls
- [x] Card no-uploadContext: `editable` computes as false → Upload/Replace/Remove hidden + file picker hidden. Preview-on-click surfaces a "Preview not available in this view" toast (no scope id to sign URL)
- [x] `App_ContractFiller` Props: added `uploadContext?: UploadContext` + `organization_id?: string`. Split into `fileFields` + `nonFileFields` via `fieldTypeMap`
- [x] Right column restructure: vertical flex containing `App_AttachmentStrip` (when `fileFields.length > 0`) + `App_ContractPreview`. Strip receives fieldStates map derived from `hrSet`/`mandatorySet`, `mode` mirrored from `isReview`, `fillerRole` pass-through, `errors` filtered to file keys
- [x] Header count reflects non-file only: `Pre-fill (${nonFileFields.length})` / `Fields (${nonFileFields.length})`

## Phase D: Inline body `(see attachments)` fallback

- [x] `ext_TipTap_FieldInput.tsx`: preview branch checks `fieldType === 'file'` first → renders italic tertiary `(see attachments)` span. Early return ensures file fields never render value text or the `[Label]` placeholder inline
- [x] Edit branch unchanged — composer file-type chips still render normally

## Phase E: Wire the 5 surfaces

- [x] `App_FormBuilderModal.tsx`: `organization_id={organizationId}`, no `uploadContext` (comment explaining composer preview is readonly)
- [x] `App_OnboardingWizardModal.tsx` step 2: `uploadContext={{ kind: 'defer' }}`, `organization_id={organizationId}`. Wizard state already accepts `Record<string, unknown>` — File values flow through
- [x] `Page_OnboardingFiller.tsx`: `uploadContext={{ kind: 'invitation_col', invitation_id: invitation.id }}`, `organization_id={invitation.organization_id}`
- [x] `App_OnboardingReviewModal.tsx`: `uploadContext` derived conditionally — `{ kind: 'invitation_col', invitation_id }` when `contract.invitation_id` exists, undefined otherwise. `organization_id={qContract.contract.organization_id}`
- [x] `App_ContractTemplateVersionsModal.tsx`: `organization_id={organizationId}`, no `uploadContext`

## Phase F: Send orchestration — resolve defer-mode Files at wizard Send

- [x] Extended `employee-onboarding_send-invitation` edge function with `skip_email?: boolean`. When true, skips HR-fill gate (gate re-runs on phase-2 email send) and skips email dispatch; returns status `pending_email`
- [x] Created new edge function `employee-onboarding_send-invitation-email` — takes `{ invitation_id }`, admin/owner auth, runs HR-fill gate against the invitation's current prefilled_fields + version's hr_field_keys, dispatches email, returns status `sent`
- [x] Inlined orchestration in `App_OnboardingWizardModal.handleSend`:
  - Partitions `prefilledFields` into `fileEntries: [col, File][]` and `scalarEntries` (non-null non-File values)
  - Fast path (no Files): existing atomic `mSend` call, no changes
  - Orchestrated path (Files present): `send-invitation({ skip_email: true, prefilled_fields: scalars })` → get `invitation_id` → `await mFilesUpload.mutation.mutateAsync` per File with `resource_type: 'invitation_col'` → PATCH `onboarding_invitations.prefilled_fields` with merged `{ ...scalars, ...resolved }` → `send-invitation-email({ invitation_id })`
- [x] Send button `loading` covers both `mSend.mutation.isPending` + a local `sendOrchestrating` boolean that wraps the phase-2 orchestration
- [x] Error handling: any phase throws → caught, console.error + `message.error` surfaces the cause. Partial-success behavior deferred: if the orchestrated path fails mid-upload, the invitation row exists but without resolved file_ids; HR can retry (currently no dedicated UI — noted for follow-up)

## Phase G: Verify

- [x] `pnpm type-check` passes with only the three pre-existing errors (`App_LoginForm.tsx`, `App_SignUpForm.tsx`, `main.tsx`); no new errors from this T2
- [~] Smoke (manual, user) — deferred to user dev-server walkthrough across the 5 surfaces listed in the plan. Agent has no way to exercise the full invitation flow end-to-end
- [~] Existing employee-column flow regression check — deferred to user smoke (Employee Detail modal file replace + Employee grid thumbnails; hook discriminated union is the only change)

---

## Plane IDs (populated by /pp)

Phase A: AHR-1848
- Task 1: AHR-1855
- Task 2: AHR-1856
- Task 3: AHR-1857
- Task 4: AHR-1858

Phase B: AHR-1849
- Task 1: AHR-1859
- Task 2: AHR-1860
- Task 3: AHR-1861
- Task 4: AHR-1862

Phase C: AHR-1850
- Task 1: AHR-1863
- Task 2: AHR-1864
- Task 3: AHR-1865
- Task 4: AHR-1866
- Task 5: AHR-1867
- Task 6: AHR-1868
- Task 7: AHR-1869

Phase D: AHR-1851
- Task 1: AHR-1870
- Task 2: AHR-1871

Phase E: AHR-1852
- Task 1: AHR-1872
- Task 2: AHR-1873
- Task 3: AHR-1874
- Task 4: AHR-1875
- Task 5: AHR-1876

Phase F: AHR-1853
- Task 1: AHR-1877
- Task 2: AHR-1878
- Task 3: AHR-1879
- Task 4: AHR-1880

Phase G: AHR-1854
- Task 1: AHR-1881
- Task 2: AHR-1882
- Task 3: AHR-1883
