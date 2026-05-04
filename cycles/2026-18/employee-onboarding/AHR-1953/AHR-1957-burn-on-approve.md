# Burn on approve — server-side pdf-lib in approve-contract

> Version: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) | Tier 1: [AHR-1953](https://plane.jimbui.dev/aiur/browse/AHR-1953/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)

## Requirements

- Fires only for PDF-kind contracts: `template_snapshot.type === 'pdf'`. TipTap-kind approval path is unchanged.
- Reads source PDF from R2 via `template_snapshot.pdf_file_path`, signature PNG from R2 via `contracts.signature_path`, field layout from `template_snapshot.layout`, and field values from `contracts.field_values` + `contracts.prefilled_fields` (merged, employee overrides prefilled).
- For each positioned field in layout: text/choice/date → draw text value at coord; signature → embed PNG image at coord. File-type fields are skipped (not embedded — they stay as separate contract attachments).
- Choice-type fields resolve value → human label via `employee_column_choices` table before drawing.
- Multi-page: iterate `pdfDoc.getPage(field.page - 1)` for each field; coordinate conversion from top-left percent (layout) to bottom-left absolute points (pdf-lib).
- Burned PDF uploaded to R2 at `orgs/{orgId}/contracts/{contractId}/signed-{timestamp}.pdf`; path written to `contracts.signed_pdf_r2_path`.
- Atomic with approval: burn failure triggers the same rollback chain (delete employee, revert contract to `filled`). Best-effort R2 cleanup on rollback (delete orphan burned PDF if upload succeeded before DB update failed).
- Resubmit unaffected — only fires at approval (status `filled` → `active`). Re-approval after void re-burns and overwrites the prior `signed_pdf_r2_path`.

## Scope boundaries

- TipTap-kind burn pipeline unchanged (continues client-side at approve).
- No HR preview of burned PDF before approval.
- No font customization per field; uses Helvetica standard font.
- No multi-line text autowrap — single-line, font auto-sized to box height (capped at 14pt).
- File-type field uploads not embedded in burned PDF.

## Decisions

- **Decision:** Burn inside existing `employee-onboarding_approve-contract` edge function, not a separate function.
  **Rationale:** Keeps the burn atomic with the approval transaction. A separate edge function would require a second invocation from the frontend and couldn't share the rollback chain. The added LOC (~80–100) is manageable in the existing ~360-line function.

- **Decision:** Read source PDF and signature directly from R2 via `GetObjectCommand` (S3Client), not via signed URLs.
  **Rationale:** Edge function already has R2 credentials in env vars (same runtime as submit-contract which does R2 writes). Direct read avoids a round-trip through the Cloudflare Worker URL-signing flow.

- **Decision:** Choice field labels resolved via DB query on `employee_column_choices`.
  **Rationale:** `field_values` stores the raw choice value (ID/code), not the human label. Drawing the raw value would show "opt_abc123" instead of "Full-time". One additional SELECT scoped to the choice-type field keys in the layout — negligible cost for correct output.

- **Decision:** Font auto-sized to 80% of box height, capped at 14pt.
  **Rationale:** Default box h_pct of 0.025 on a US Letter page (~792pt) yields ~20pt box height → ~16pt raw, capped at 14pt for readability. Smaller boxes (HR-resized) scale down proportionally. No risk of text rendering outside the box vertically.

- **Decision:** Coordinate system: `x_abs = x_pct * pageWidth`, `y_abs = pageHeight - (y_pct + h_pct) * pageHeight` (pdf-lib origin is bottom-left; layout origin is top-left).
  **Rationale:** pdf-lib's y=0 is the page bottom. The layout's y_pct=0 is the page top. Converting y_pct to bottom-left by subtracting from height and accounting for box height gives the correct bottom-left corner of the box.

## Implementation

### Phase A — Dependencies + R2 client setup

Add `@aws-sdk/client-s3` and `pdf-lib` to the approve-contract edge function. Initialize S3Client and add a `fetchR2Object` helper. Same pattern as submit-contract.

- [x] Add `"@aws-sdk/client-s3": "npm:@aws-sdk/client-s3"` and `"pdf-lib": "npm:pdf-lib@1.17.1"` to `employee-onboarding_approve-contract/deno.json` imports
- [x] Add R2 env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) + S3Client initialization at module level (same as submit-contract pattern)
- [x] Add `fetchR2Object(key: string): Promise<Uint8Array>` helper using `GetObjectCommand` — reads an R2 object and returns its body as bytes
- [x] Import `PDFDocument, StandardFonts, rgb` from `"pdf-lib"` and `GetObjectCommand, PutObjectCommand, S3Client` from `"@aws-sdk/client-s3"`

### Phase B — burnPdfContract function

Standalone async function that takes the source PDF bytes, signature bytes, layout, merged field values, and choice label map; returns the burned PDF as `Uint8Array`.

- [x] Create `burnPdfContract({ sourcePdfBytes, signatureBytes, layout, fieldValues, choiceLabels }): Promise<Uint8Array>` function
- [x] Load source PDF via `PDFDocument.load(sourcePdfBytes)`
- [x] Embed Helvetica font via `pdfDoc.embedFont(StandardFonts.Helvetica)`
- [x] Embed signature PNG via `pdfDoc.embedPng(signatureBytes)` (only when signatureBytes is non-null)
- [x] Iterate layout fields, for each: get page via `pdfDoc.getPage(field.page - 1)`, compute absolute coords from percent values, branch by field type:
  - `signature` → `page.drawImage(signatureImage, { x, y, width: boxW, height: boxH })`
  - `text` / `date` → `page.drawText(String(value), { x: x + 2, y: y + verticalCenter, size: fontSize, font, color: rgb(0,0,0) })`
  - `choice` → resolve value via choiceLabels map, then drawText with the label
- [x] Font size = `Math.min(boxH * 0.8, 14)` — auto-scales to box, capped at 14pt
- [x] Return `pdfDoc.save()` (Uint8Array)

### Phase C — Integration into approve flow

Wire the burn into the existing approval pipeline. Fetch additional data needed for PDF-kind, call burnPdfContract, upload result, set signed_pdf_r2_path.

- [x] Expand contract SELECT (line 94) to include `template_snapshot, signature_path`
- [x] After contract update to `active` (line 246), add the PDF burn block gated on `templateSnapshot.type === 'pdf'`
- [x] Merge field values for burn: `const burnValues = { ...(contract.prefilled_fields as Record<string,unknown> ?? {}), ...(contract.field_values as Record<string,unknown> ?? {}) }` — employee values override prefilled
- [x] Fetch choice labels: collect choice-type field keys from layout → SELECT from `employee_column_choices` WHERE `employee_column_id IN (...)` → build `Record<string, Record<string, string>>` (column → value → label)
- [x] Fetch source PDF bytes from R2 via `fetchR2Object(templateSnapshot.pdf_file_path)`
- [x] Fetch signature bytes from R2 via `fetchR2Object(contract.signature_path)` (skip if null — unsigned contracts shouldn't reach approval, but defensive)
- [x] Call `burnPdfContract(...)` with all resolved data
- [x] Upload burned bytes to R2 at `orgs/${orgId}/contracts/${contractId}/signed-${Date.now()}.pdf` via `PutObjectCommand`
- [x] PATCH `contracts.signed_pdf_r2_path` with the R2 key
- [x] On any failure in the burn block: rollback employee + contract status to `filled` (same as existing error branches), best-effort `DeleteObjectCommand` on the uploaded R2 key if it was written

### Phase D — Verification

- [ ] Create a PDF template with text, single_select, date, and signature fields across multiple pages
- [ ] Send invitation → employee fills all fields + signs → submit
- [ ] HR approves → verify `signed_pdf_r2_path` is populated on the contract row
- [ ] Download burned PDF from R2 and verify: text values at correct positions, choice labels (not codes) rendered, signature image at configured coords, multi-page layout correct
- [ ] Approve a TipTap-kind contract → verify approval still works and `signed_pdf_r2_path` stays null
- [ ] Simulate burn failure (e.g., invalid PDF source) → verify rollback (employee deleted, contract reverted to `filled`)

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: Final step of the PDF contract pipeline — produces the flat signed PDF that HR can download after approving an employee's filled contract.
Tech: `employee-onboarding_approve-contract/index.ts` (Deno edge fn), `pdf-lib` for PDF editing, `@aws-sdk/client-s3` for R2 read/write, `contracts.signed_pdf_r2_path` column (AHR-1954), `PdfLayout` type from `contractTemplate.types.ts`
Related: [Employee Onboarding](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) - version doc with planning decisions
Siblings: 4 total, 3 Done (local, pending /pp) — [AHR-1954 Schema (done local), AHR-1955 Builder (done local), AHR-1956 Filler (done local)]
Execution Order: Step 3 of 3 — all done ✓
Outline Spec: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff
