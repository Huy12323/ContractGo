# Employee filler for PDF kind — fill cards + live positioned overlay

> Version: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) | Tier 1: [AHR-1953](https://plane.jimbui.dev/aiur/browse/AHR-1953/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)

## Requirements

- `Page_OnboardingFiller` reads `type` from the invitation `template_snapshot` and routes to the PDF render branch when `type='pdf'`.
- `App_ContractFiller` accepts a discriminated `layout` shape — `JSONContent` for tiptap, `PdfLayout` for pdf — and branches the right-pane render. Existing tiptap callers keep working with no signature change beyond the discriminator.
- PDF render branch: side-by-side shell unchanged (fill cards left); right pane renders `App_PdfDocument` (the wrapper added by AHR-1955) with positioned input overlays per page; zoom controls visible.
- Live overlay values: as the employee types into a fill card, the value renders inline at the positioned coord on the PDF page (text/choice/date as text node, signature as image). Empty fields render an italic gray placeholder (the field label) at the coord.
- State parity with tiptap kind: mandatory / hr_field_keys / optional / attachment all behave identically. HR-prefilled fields render readonly with value visible. File fields render only as fill cards (no positioning on PDF) — same as tiptap.
- Signature: reuses `App_SignaturePad` (placement below the document, same as tiptap kind). Signed PNG dataURL renders as an `<img>` overlay at the configured signature-field coord.
- Submit: flows through existing `employee-onboarding_submit-contract` edge function unchanged. Resubmit path unaffected.
- HR pre-fill (wizard Step 2 in `App_OnboardingWizardModal`): same composite renders for PDF-kind invitations; values land in `onboarding_invitations.prefilled_fields` as today.
- HR review (`App_OnboardingReviewModal`): same composite renders the filled PDF contract in `mode='review'`; signature image visible at coord.

## Scope boundaries

- Burning the flat PDF — AHR-1957 (server-side pdf-lib at HR approval).
- HR preview of burned PDF before approval — explicitly out of T1 scope.
- File uploads embedded in the rendered PDF preview — file fields stay as separate attachments on the contract row.
- Filler-side zoom does NOT change stored coords — same coord stays positioned correctly across zoom levels.

## Decisions

- **Decision:** App_ContractFiller refactor approach: discriminated `layout` prop + internal `kind` branch (option i from /p Q&A).
  **Rationale:** Smallest churn across the 4 surfaces that already use the composite (builder preview, wizard Step 2, employee filler, review modal). Tiptap callers need no signature change; PDF kind callers explicitly pass a `PdfLayout` value. Per-surface migration is opt-in.
- **Decision:** Consume the shared `App_PdfDocument` component built in AHR-1955; no new react-pdf wrapper here.
  **Rationale:** Single source of truth for multi-page rendering, zoom, and per-page dim exposure. Avoids drift between HR-side and employee-side render behavior.
- **Decision:** Signature pad placement stays below the document (same as tiptap kind).
  **Rationale:** Consistent UX across kinds; the signature pad is a separate input modality. The drawn signature image overlays at the configured coord on the PDF page as live visual confirmation. Forcing the pad to live on the PDF page would compete with positioned input fields.
- **Decision:** Live overlay values are rendered into the page's overlay layer as either positioned `<input>` (for typing) OR positioned readonly text (for review mode / HR-prefilled fields).
  **Rationale:** Same `fieldValues` state powers both fill cards and overlay; single source of truth. Mode + role + key-set membership decide whether each overlay is editable, readonly-with-value, or empty placeholder.
- **Decision:** Zoom controls visible in filler (per user request — important for readability across screen sizes).
  **Rationale:** Coords are 0–1 floats — zoom is purely visual. Reuses the `App_PdfZoomControls` component from AHR-1955.
- **Decision:** Wizard Step 2 + Review modal inherit PDF support automatically once `App_ContractFiller` branches internally.
  **Rationale:** Both surfaces already render `App_ContractFiller`; once the composite handles PDF kind, no per-surface code change is needed beyond passing through `template.type` + the kind-shaped layout. Wizard reads from `selectedTemplate.{type, layout}` (typed via T2 #1); Review reads from `contract.template_snapshot.{type, layout}` (wrapped shape, defensive read already in place).
- **Decision:** File-type fields render in a side-pane attachment strip identical to tiptap kind, never overlaid on PDF pages.
  **Rationale:** Per AHR-1955 builder design — uploading a file to a coord on a PDF has no coherent UI. Attachment strip is the natural representation.
- **Decision:** PDF URL is resolved from the snapshot's `pdf_file_path`, not the live template's. Filler reads `invitation.template_snapshot.pdf_file_path`; HR review reads `contract.template_snapshot.pdf_file_path`.
  **Rationale:** AHR-1487 self-sufficiency invariant — snapshots must remain renderable after template hard-delete. Live-template reads only apply to wizard Step 2 (pre-invitation), where no snapshot exists yet.
- **Decision:** New `invitation_pdf` resource type on `files_r2_sign-read-url`, dual-auth (invitee email match OR admin/owner). Reads the snapshot's path, signs the resulting r2_key.
  **Rationale:** Existing `contract_template_pdf` resource (AHR-1955) is admin/owner-only — invitees can't pass that gate. Dual-auth pattern mirrors `invitation_col` (also invitee-accessible). One resource type covers filler (invitee) + wizard Step 2 (admin) + review modal (admin via contract.invitation_id).
- **Decision:** PDF URL resolution lifted to **page/modal level** (Page_OnboardingFiller, App_OnboardingReviewModal, App_OnboardingWizardModal), passed to `App_ContractFiller` as a `pdfFileUrl` prop. `App_ContractFiller` is a pure consumer.
  **Rationale:** Matches the AHR-1955 pattern (URL resolution lives at App_FormBuilderModal, App_PdfFieldEditor consumes). Keeps the composite testable in isolation and avoids duplicate hook calls when multiple surfaces share the same source PDF.

## Implementation

### Phase A — App_ContractFiller refactor: discriminated layout + kind branch

Widen the composite's prop type and branch the document-rendering code path. Tiptap behavior unchanged.

- [x] Props refactored to discriminated union: `SharedProps & ({kind?: 'tiptap'; layout: JSONContent; pdfFileUrl?: never} | {kind: 'pdf'; layout: PdfLayout; pdfFileUrl: string | null})`. Tiptap-default keeps existing callers unchanged.
- [x] Right-pane render branches on `props.kind === 'pdf'` → `ContractFillerBody_Pdf` placeholder (Phase B fills it in); else → `ContractFillerBody_Tiptap` (extracted internal subcomponent)
- [x] TipTap editor lifecycle moved into `ContractFillerBody_Tiptap` so it only mounts for tiptap kind. PDF kind doesn't pay the editor instantiation cost.
- [x] Sibling `extractFields_Pdf(layout, columns)` added (export). Resolves labels via columns + universals + signature special-case. Same output shape as `extractFields` so the fill-card render path is identical for both kinds.
- [x] No changes to `mandatorySet/hrSet/attachmentSet` plumbing — confirmed unchanged
- [x] No changes to `fieldValues / onChange` interface — confirmed unchanged
- [x] `pnpm type-check` passes

### Phase B — Auth-extension + PDF render branch

Two parts: edge-function/hook plumbing for invitee-accessible PDF URLs, then the actual `ContractFillerBody_Pdf` render.

**Phase B.1 — Auth extension (NEW; not in original plan):**

- [x] Extended `files_r2_sign-read-url`: `invitation_pdf` resource type added. Reads `invitation.template_snapshot.pdf_file_path`. Dual auth (invitee email match OR `isOrgAdminOrOwner`). Returns 404 if snapshot has no `pdf_file_path` (tiptap kind invitation).
- [x] New hook `useQ_Invitation_PdfReadUrl({ invitationId, pdfFilePathKey })` at `src/hooks/useQ_Invitation_PdfReadUrl.ts`. Uses `QueryKeys.onboarding_invitations.record()` + `pdfFilePathKey` discriminator. 6-day stale time.
- [x] `useQ_ContractTemplate_PdfReadUrl` untouched.
- [x] `pnpm type-check` passes.

**Phase B.2 — Render branch (ContractFillerBody_Pdf):**

- [x] `pdfFileUrl` resolved by parent (page/modal level) and passed in as a prop. PDF body is a pure consumer — no internal hook calls.
- [x] `App_PdfZoomControls` rendered in an internal toolbar above the document (right-aligned).
- [x] Per-page overlay renderer with `zIndex: 3` (above react-pdf's text layer) and `pointer-events: none` (children opt back in via `auto`). Each layout entry filtered to its page → `<PdfFieldOverlay>` positioned via percent left/top/width/height.
- [x] Per-overlay rendering by state + mode (using `resolveFieldState`):
  - Editable text → native `<input type="text">` sized 100%/100% with theme-token border + bg
  - Editable date → native `<input type="date">`
  - Editable single-select → native `<select>` with choices + empty option
  - Editable multi-select → readonly inline summary (comma-separated labels). Multi-select editing happens in the left fill-card sidebar; inline multi-select would overflow tiny boxes.
  - HR-locked / review readonly → plain text or italic gray `[fieldKey]` placeholder when empty
  - Signature → `<img>` when value is a string (PNG dataURL); else dashed-border italic "Signature" placeholder
- [x] Native HTML elements (not ANTD) used for inputs to scale naturally with box dimensions. Theme tokens provide color/border/radius styling.
- [x] `pnpm type-check` passes

### Phase C — Page_OnboardingFiller kind detection + URL resolution

Route to the right kind based on the invitation snapshot, and resolve the PDF URL at page level.

- [x] Snapshot type widened to wrapped shape `{type, layout, pdf_file_path, mandatory/hr/attachment_field_keys}`. `kind` derived from `snapshot.type` (defaults to `'tiptap'`).
- [x] For PDF kind: `useQ_Invitation_PdfReadUrl({ invitationId, pdfFilePathKey })` called with the snapshot's `pdf_file_path` as the cache discriminator. Hook's `enabled` gate keeps it dormant for tiptap kind (both args undefined).
- [x] App_ContractFiller call site branches on `kind`: PDF passes `kind="pdf"`, `layout={pdfLayout}`, `pdfFileUrl={qReadUrl.url ?? null}`; tiptap path unchanged (omits `kind`, defaults to tiptap)
- [x] `existingTemplateKeys` extraction is kind-aware: `extractFields_Pdf(pdfLayout, columns)` for PDF, `extractFields(layout)` for tiptap. Mandatory validation works for both kinds.
- [x] `attachmentFieldKeys` flows through unchanged from `snapshot.attachment_field_keys` (T2 #1 snapshot shape covers both kinds).
- [x] `pnpm type-check` passes

### Phase D — HR pre-fill (wizard Step 2) + Review modal — URL resolution + prop flow

Both surfaces already render `App_ContractFiller`. After Phase A, they support PDF kind via the discriminator. This phase wires up URL resolution at modal level and passes `pdfFileUrl` down.

- [x] `App_OnboardingWizardModal` Step 2: derived `selectedTemplateKind`, called `useQ_ContractTemplate_PdfReadUrl` (existing admin hook) gated to PDF kind. Step 2 body branches on kind — PDF passes `kind="pdf"`, `pdfFileUrl`, and `layout` cast to PdfLayout; tiptap unchanged. Both share `prefilledFields`, `hrFieldErrors`, `uploadContext: 'defer'`.
- [x] `App_OnboardingReviewModal`: derived `contractKind` + `contractSnapshot` from the wrapped `contract.template_snapshot`. Called `useQ_Invitation_PdfReadUrl` via `contract.invitation_id` (dual-auth, admin path). Body branches on kind. Hook's `enabled` gate handles the legacy "no invitation_id" case naturally — no URL fires, the placeholder loading state shows briefly.
- [x] `pnpm type-check` passes

### Phase E — Verification

- [ ] `pnpm type-check` passes
- [ ] Manual smoke (dev browser): with a PDF-kind template + invitation present (built via AHR-1955), open `Page_OnboardingFiller` → PDF renders, zoom works, fill cards appear on left, typing into a card updates the overlay value live
- [ ] Manual smoke: HR-prefilled values render readonly + visible at their coords
- [ ] Manual smoke: draw signature → submit → contract row written; status flips to `filled`
- [ ] Manual smoke: open `App_OnboardingWizardModal` → pick PDF template at Step 1 → Step 2 renders PDF preview with HR-fill cards
- [ ] Manual smoke: open `App_OnboardingReviewModal` for a filled PDF contract → review renders correctly
- [ ] Manual smoke: existing tiptap contracts and invitations render with no regression

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Employee side of PDF kind. Employees see a rendered PDF on the right with positioned input fields they fill in; values render inline on the document as they type. Same fill-card sidebar as the existing tiptap experience. HR pre-fill and HR review reuse the same composite automatically.
Tech: `App_ContractFiller.tsx` (discriminated layout + kind branch), `Page_OnboardingFiller.tsx` (kind detection), `App_OnboardingWizardModal.tsx` (Step 2 prop flow), `App_OnboardingReviewModal.tsx` (snapshot read extends to kind/pdf_file_path), consumes `App_PdfDocument` + `App_PdfZoomControls` from AHR-1955.
Related: AHR-1954 (snapshot shape — kind + pdf_file_path on snapshots), AHR-1955 (builder + shared App_PdfDocument component this T2 consumes), AHR-1957 (burn — server-side at approve, separate path).
Siblings: 4 total, 1 Done (local, pending /pp) — AHR-1954 Schema (Done local), AHR-1955 Builder (Todo or In Progress depending on parallel start, 8 pts), AHR-1957 Burn (Todo, 5 pts).
Execution Order: Step 2 of 3 — AHR-1954 effective state Done (local). Sibling AHR-1955 is parallel (also step 2). This T2 has a soft dependency on AHR-1955's `App_PdfDocument` component — implementation can start in parallel (mock the wrapper if needed), but Phase B end-to-end requires AHR-1955 Phase B done.
Outline Spec: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff (PDF contract templates — T1 Scoping + AHR-1956 Planning sections)
