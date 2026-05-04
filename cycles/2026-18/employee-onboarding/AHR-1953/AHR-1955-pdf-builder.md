# PDF builder — kind selector + R2 upload + multi-page overlay editor

> Version: [Outline](https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff) | Tier 1: [AHR-1953](https://plane.jimbui.dev/aiur/browse/AHR-1953/) | Module: [Plane](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)

## Requirements

- Kind selector pill in `App_FormBuilderModal` toolbar (TipTap | PDF). Switching kind discards current layout (confirm modal). Switch + Save = single new `contract_template_versions` row with new `{type, layout, pdf_file_path}`.
- HR can upload a source PDF for `pdf` kind templates via the existing R2 pipeline (extended with a new `contract_template_pdf` resource type). R2 path: `orgs/{org_id}/contract-templates/{template_id}/{filename}`. Re-upload replaces with a confirm.
- All pages render via `react-pdf` (vertical scroll); fit-to-container-width by default; zoom controls (in/out/reset) operate on the rendered scale.
- Field placement: clicking on a page from the field palette drops a default-sized box at the click coord. Default sizes: text/choice/date `{w_pct: 0.20, h_pct: 0.04}`, signature `{w_pct: 0.30, h_pct: 0.08}`. Box is draggable + resizable via 4 corner handles using pointer events on absolutely-positioned divs (no library).
- Coords stored as 0–1 floats per page dimension (resolution + zoom-independent).
- Per-field controls (mandatory / hr / optional / attachment cycle, field key, label, type) work identically to TipTap kind.
- File-type fields appear in the side fill-card / attachment panel only — never positioned on PDF pages.
- Save persists `layout` JSONB `[{key, page, x_pct, y_pct, w_pct, h_pct, type}]` + `type='pdf'` + `pdf_file_path` and round-trips the AHR-1489 versioning trigger producing one new version row (or no-op on hash match).
- History viewer + Restore work for PDF kind — the version preview pane renders `App_PdfDocument` with read-only overlays at historical coords; Restore writes a new template version with the historical `{type, layout, pdf_file_path}`.

## Scope boundaries

- No PDF cropping / rotation / page deletion / reorder.
- No drag-to-reorder in fill-card sidebar (display order = template definition order).
- No snap-to-grid, alignment guides, multi-select.
- No diff/compare between historical versions.
- Filler-side PDF render path (employee viewing) is AHR-1956's scope. Burn pipeline is AHR-1957's.

## Decisions

- **Decision:** Install `react-pdf` (wojtekmaj wrapper) and create a shared `App_PdfDocument` component in this T2; AHR-1956 (filler) consumes the same component.
  **Rationale:** Builder is the heavier T2 and naturally owns the install + base wrapper. Single source of truth for PDF rendering + zoom semantics across HR-side (builder, history viewer, wizard, review modal) and employee-side (filler).
- **Decision:** Same `App_FormBuilderModal` with internal kind branch — not a new companion modal.
  **Rationale:** Matches the T2 spec wording ("Kind selector in App_FormBuilderModal"). Toolbar (kind selector, history, save), attachment panel, and field palette stay shared. Body branches: TipTap editor for `tiptap` kind, PDF overlay editor for `pdf` kind. Avoids duplicating toolbar logic across two files.
- **Decision:** Source-PDF upload extends `useM_Files_Upload` with a new `contract_template_pdf` resource type.
  **Rationale:** Reuses the established R2 pipeline (presign → PUT → files row). The new branch in `files_r2_upload-start` writes to a stable path scoped by template_id so re-uploads can replace cleanly. Org-scoped under `orgs/{org_id}/contract-templates/{template_id}/`.
- **Decision:** Multi-page = vertical scroll with all pages stacked.
  **Rationale:** Simpler than paged navigation; matches how HR thinks about a contract document; works naturally with overlay positioning (each page is its own positioned container).
- **Decision:** Zoom controls (in / out / fit-to-width reset) on the toolbar.
  **Rationale:** Real contracts often need precise field placement; zoom lets HR work at 150–200% then return to fit-to-width. Coordinates remain stored as 0–1 floats so zoom is purely visual — placement never breaks across zoom levels.
- **Decision:** Field box drag + resize uses pointer events + absolutely-positioned divs with 4 corner handles. No library.
  **Rationale:** Free-position drag-resize is ~50–80 LOC of vanilla code. Libraries (`interact.js`, `dnd-kit`) add weight without solving the actual problem (free-position, not list reorder).
- **Decision:** Default field box sizes — text/choice/date `{w: 0.20, h: 0.04}`, signature `{w: 0.30, h: 0.08}`.
  **Rationale:** Approximates a normal text input on a letter-sized page (~150px wide, ~30px tall at 100%). Signature larger to fit a hand-drawn signature. HR can resize after dropping.
- **Decision:** Kind switch discards layout on first save; the AHR-1489 versioning trigger writes a new version row with new `{type, layout}` (hash differs).
  **Rationale:** Versioning machinery already handles type changes (per AHR-1789 hash formula). No special "kind switch" code path needed beyond the confirm modal in the UI.
- **Decision:** History/Restore plumbing for PDF kind reuses the AHR-1640-style payload pattern — `onRestored` callback already carries layout + type + pdf_file_path; PDF kind just provides different layout shape.
  **Rationale:** Per the version doc, the restore callback already supports the kind-agnostic payload. No callback signature changes needed.

## Implementation

### Phase A — Dependencies + R2 upload extension

Add the libraries and extend the file upload pipeline so the builder can persist a source PDF.

- [x] `pnpm add react-pdf` in `frontend/vite/` (v10.4.1)
- [x] Worker config at `src/configs/pdfjs/config.ts` (Vite URL bundling — no CDN); imported once in `src/main.tsx` for side-effect setup
- [x] `files_r2_upload-start/index.ts`: added `contract_template_pdf` to `RESOURCE_TYPES`; new branch resolves org via template, gates on admin/owner, writes R2 key `orgs/{org_id}/contract-templates/{template_id}/{timestamp}-{uniqueId}-{filename}`
- [x] `useM_Files_Upload`: added `UseM_Files_Upload_Params_ContractTemplatePdf` discriminant; `buildUploadStartBody` branch added; thumbnail generation naturally no-ops for PDF mime type
- [x] `pnpm type-check` passes
- [ ] **Smoke deferred** — upload becomes user-callable in Phase D once the builder UI lands

### Phase B — Shared `App_PdfDocument` component

The thin wrapper around `react-pdf` that both builder and filler render. Owns multi-page layout + zoom semantics; exposes per-page dimensions for overlays.

- [x] Created `src/components/employees/App_PdfDocument.tsx`. Props: `fileUrl`, `scale` (1.0 = fit-to-container-width, multiplied on top), `overlayRenderer(page)` slot, `onLoadError`, `onLoadSuccess`. Uses `ResizeObserver` to track container width; renders all pages stacked vertically via react-pdf's `<Document>` + `<Page>`
- [x] Each page wrapped in `position:relative` container; overlay layer is absolute `inset:0` with `pointer-events:none` (consumer children opt in via `pointer-events:auto`). Percent-based positioning works directly because the overlay matches the rendered page's bounds
- [x] No explicit `onPagesLoaded` dim callback needed — consumers position with percentages; the overlay layer matches rendered dims automatically across zoom changes
- [x] Created `src/components/employees/App_PdfZoomControls.tsx` — zoom out / reset-to-fit / zoom in buttons + percent label; ANTD `type="text" size="small"` per `ext-airtable-toolbar` style (borderless, compact)
- [x] `pnpm type-check` passes

### Phase C — Kind selector + builder body branch in `App_FormBuilderModal`

Add the toolbar pill and route to a new internal `BuilderBody_Pdf` section when `type='pdf'`. Existing TipTap editor stays as `BuilderBody_TipTap` (extracted only if necessary; otherwise inline).

- [x] `useQ_Tables_ContractTemplates` SELECT extended to include `type` and `pdf_file_path`; hydration reads them with default `'tiptap'` for new templates
- [x] Header bar: ANTD `Segmented` kind selector (TipTap | PDF) added with `marginLeft: auto`; on change calls `handleKindChange` which fires a `modal.confirm` warning the layout will be discarded
- [x] On confirm: clears the kind-specific layout (TipTap doc → empty paragraph OR PDF layout → []); when switching to TipTap also clears `pdf_file_path`; dirty flag rides on the existing dirty-check effect (extended to track `kind`, `pdfFilePath`, `pdfLayout`)
- [x] Body branched: `preview` keeps existing App_ContractFiller; `kind === 'pdf' && !preview` renders a Phase-D placeholder card showing pdfFilePath + layout count; `kind === 'tiptap' && !preview` renders the existing TipTap editor + attachments panel
- [x] TipTap toolbar (heading/bold/italic/etc.) hidden when `kind === 'pdf'`
- [x] `App_PdfZoomControls` rendered in header bar only when `kind === 'pdf' && !preview` (zoom state lives in the modal, will be passed down to the actual PDF render path in Phase D)
- [x] Save / Save-As handlers extended: include `type` + `pdf_file_path`; layout shape branches by kind (TipTap doc when tiptap, PdfLayout array when pdf)
- [x] Restore handler extended: handles `body.type === 'pdf'` by storing the PdfLayout into state and emptying the TipTap editor; reverse for tiptap restore
- [x] `useM_ContractTemplate_Update` and `useM_ContractTemplate_Create` body types widened to accept `type` + `pdf_file_path`
- [x] `App_ContractTemplateVersionsModal_OnRestored.layout` type widened from `JSONContent` to `JSONContent | unknown` (consumer branches on `type`)
- [x] `pnpm type-check` passes

### Phase D — PDF overlay editor (BuilderBody_Pdf)

The new internal subcomponent that handles upload, render, and positioned-field placement.

- [x] New component `App_PdfFieldEditor.tsx` (~400 LOC) hosts the entire PDF builder body (upload, render, click-to-drop, drag, resize, delete, state cycle)
- [x] New hook `useQ_ContractTemplate_PdfReadUrl.ts` resolves a signed URL for the source PDF (`pdf_file_path` is a raw r2_key, not a `files` row)
- [x] Edge function `files_r2_sign-read-url` extended with a `contract_template_pdf` resource type (admin/owner gated) — mirrors the `contract_signature` pattern (raw r2_key, no files row)
- [x] Empty state shows a centered ANTD `Upload` card when no PDF is set (saved or pending). **Refactored to defer R2 upload until Save** — picked file is held in browser memory as `pendingPdfFile` + a `URL.createObjectURL` blob URL feeds the renderer. No R2 round-trip on pick; HR can place fields against the in-memory PDF, and discarding the modal cleanly drops the file (no orphan R2 objects). Save handler runs the actual upload + DB patch in one flow. Size validation at pick time so HR doesn't place fields against an oversized PDF that would later be rejected at upload.
- [x] Replace-PDF action in the action bar: confirm modal → triggers hidden Upload input → handleUpload (same path as initial upload)
- [x] PDF rendered via `App_PdfDocument` with an `overlayRenderer` slot — overlay layer per page is `pointer-events: none` by default (passes through to PDF), but flips to `auto` + `cursor: crosshair` when `pendingFieldDrop` is set, capturing the next click as drop intent
- [x] Click-to-drop: computes click pos relative to overlay, appends a `PdfLayout_PositionedField` entry with `page = pageNumber`, default size per type (text/choice/date 20×4%, signature 30×8%), clamps to fit inside page; consumes the pending field via callback; auto-selects the new field
- [x] Drag move: `onPointerDown` on field box captures `pageRect` + start pos; window-level `pointermove` updates `x_pct/y_pct` (clamped, accounts for box width/height to stay inside page); `pointerup` commits + clears
- [x] Resize via 4 corner handles (`nw`/`ne`/`sw`/`se`): each handle stops propagation, captures corner identity, and pointermove recomputes `x/y/w/h` so the opposite corner stays anchored; min size 5% × 5%
- [x] Per-field state cycle: `App_FieldStateDropdown` rendered inside selected box's controls; calls back to the modal's `setFieldState` (same handler used by TipTap chips)
- [x] Delete: × button next to state dropdown when selected; splices field out of layout, clears selection
- [x] Border color reflects field state (mandatory=danger, hr=info, optional=neutral); selected box gets primary tint background + shadow
- [x] "Add signature" button in action bar drops a signature field at default coords (page 1, bottom-right area) — signature isn't an employee column so it has no palette entry; this dedicated button is the entry point
- [x] Modal-side wiring: new `pendingPdfField` state (click-to-drop) + `pendingPdfFile` state (deferred upload), `insertField` extended to set click-to-drop for PDF kind, `effectiveUsedKeys` includes PDF layout keys (so palette grays them out), kind-change clears both pending states, hydration resets both pending states, dirty check treats `pendingPdfFile !== null` as dirty
- [x] Save flow extended for PDF kind with pending file: stub-create the template (if new) → upload PDF using new template_id → PATCH with full body including resolved `pdf_file_path`. 2-write trade-off accepted to keep the upload-after-save UX. Save-As mirrors the same pattern with a fresh template_id so the new template gets its own R2 path. Existing-template + pending file = upload + PATCH (single template_id, no stub create)
- [ ] Field-key / label edit popover **deferred** — out of MVP scope; field labels currently come from `resolveField(key)` which derives from employee_columns + universals. Editing a label means editing the underlying column (separate flow). Skipping unless we add a "rename inline on PDF" UX later.
- [x] `pnpm type-check` passes

### Phase E — Save flow + history/restore for PDF kind

Save and dirty detection were absorbed into Phase C (save handlers + dirty-check effect) and Phase D (pending-file dirty flag + save flow with deferred upload). Version history preview wired up separately.

- [x] Save handler for PDF kind: absorbed into Phase C — save/Save-As handlers branch on kind, include `type` + `pdf_file_path`, layout shape branches by kind. Phase D extends with deferred-upload flow (stub-create → upload → PATCH)
- [x] Dirty detection: absorbed into Phase C — dirty-check effect extended to track `kind`, `pdfFilePath`, `pdfLayout`. Phase D adds `pendingPdfFile !== null` as dirty signal
- [x] `App_ContractTemplateVersionsModal`: branches preview on `selectedKind` — PDF versions render `App_ContractFiller` with `kind="pdf"`, `pdfFileUrl` from `useQ_ContractTemplate_PdfReadUrl`, and `layout` cast to `PdfLayout`; TipTap versions render unchanged. Restore callback already handles both kinds (Phase C)
- [ ] Verify a save against an existing `pdf` template produces a new `contract_template_versions` row with the new content_hash (manual test via psql post-save)

### Phase F — Verification

- [ ] `pnpm type-check` passes
- [ ] Manual smoke (dev browser): create a new template → switch to PDF kind via toolbar pill → confirm dialog appears → upload a multi-page PDF → drop a text field on page 1 → drag it → resize it → drop a signature field on page 2 → save → verify new `contract_template_versions` row exists with `type='pdf'` and the layout array
- [ ] Manual smoke: re-open same template → verify layout renders at the same positions across zoom levels (50%, 100%, 150%)
- [ ] Manual smoke: open History viewer → click an older version → preview renders historical layout → Restore → composer state updates to historical values
- [ ] Manual smoke: switch back to TipTap kind → confirm dialog → layout cleared → save → verify new version row with `type='tiptap'`
- [ ] Manual smoke: existing TipTap templates open and edit/save without regression

## Context

_Stripped at /pp push time. Lives in the plan file only, for agent orientation during `/s` and for sibling awareness during concurrent `/p` sessions._

Non-tech: HR side of the new PDF kind. HR uploads a source PDF and drags fields onto the rendered pages to build a contract template. Same modal as TipTap templates; switching between the two is destructive (layout discarded).
Tech: `App_FormBuilderModal.tsx` (kind selector + body branch), new `App_PdfDocument.tsx` + `App_PdfZoomControls.tsx`, `App_ContractTemplateVersionsModal.tsx` (PDF preview + restore plumbing), `useM_Files_Upload.ts` (new resource type), `files_r2_upload-start/index.ts` (new branch), `react-pdf` install + worker config.
Related: AHR-1954 (foundation — schema + snapshot shape), AHR-1956 (filler — consumes App_PdfDocument), AHR-1957 (burn — uses pdf-lib server-side at approve, separate code path).
Siblings: 4 total, 1 Done (local, pending /pp) — AHR-1954 Schema (Done local), AHR-1956 Filler (Todo, 5 pts), AHR-1957 Burn (Todo, 5 pts).
Execution Order: Step 2 of 3 — AHR-1954 effective state Done (local). Sibling AHR-1956 is parallel (also step 2).
Outline Spec: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff (PDF contract templates — T1 Scoping + AHR-1955 Planning sections)
