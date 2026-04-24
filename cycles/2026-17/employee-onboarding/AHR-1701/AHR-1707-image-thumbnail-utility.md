# Client-side image thumbnail utility

Work Item: AHR-1707 (https://plane.jimbui.dev/aiur/browse/AHR-1707/)
Tier 1: AHR-1701 [v0.0.1 | Employee Onboarding] File attachments — strip UI, thumbnail generation, extract from inline field flow (In Progress)
Module: Employee Onboarding (https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/36675ec5-93bc-401b-b769-8ea03d23843e/)
Outline Spec: https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b
Version Doc: https://outline.jimbui.dev/doc/d1813dac-0177-4ea5-88a1-88ed88969bff

## Context (from spec)

Non-tech: Before an uploaded image hits R2, the browser generates a small webp thumbnail via Canvas. The upload flow (AHR-1711) will upload that thumbnail alongside the original, and the attachment strip (AHR-1713) will render it. Pure utility — no React, no side effects.

Tech: New file `frontend/vite/src/utils/Utils_Files_ImageThumbnail.ts`. Signature `Utils_Files_ImageThumbnail(file: File, opts?: { maxDim?: number; quality?: number }): Promise<Blob | null>`. Loads the file via `URL.createObjectURL` + `<img>`, resizes on `<canvas>` preserving aspect ratio (default max 200px), exports via `canvas.toBlob('image/webp', quality)` (default 0.8). Returns `null` for non-image MIME or any failure — upload-flow treats `null` as "no thumbnail, fall back to generic file icon in strip".

Related: AHR-1705 (schema — `thumbnail_r2_key`) provides storage; AHR-1711 (upload flow) consumes this utility; AHR-1713 (strip component) renders the resulting thumbnail. Sibling AHR-1709 (doc microservice) handles the non-image path.

Siblings: 6 total, 1 Done (local, pending /pp) — AHR-1705 Schema (Done local), AHR-1709 Doc microservice (Todo, Not started), AHR-1711 Upload flow (Todo, Not started), AHR-1713 Strip component (Todo, Not started), AHR-1715 Wire strip (Todo, Not started)

Execution Order: Step 2 of 5 — prereq met (AHR-1705 locally Done). Runs in parallel with AHR-1709.

## Phase A: Utility implementation

- [x] Create `frontend/vite/src/utils/Utils_Files_ImageThumbnail.ts`
- [x] Guard: if `!file.type.startsWith('image/')` → resolve `null` (upload flow handles non-images via the microservice path, not this utility)
- [x] Load via `URL.createObjectURL(file)` into an `<img>` element; wrap in a Promise that resolves on `load`, rejects on `error`; always revoke the object URL in a `finally`
- [x] Compute target dimensions — `const maxDim = opts?.maxDim ?? 200`; preserve aspect ratio; do NOT upscale if source is smaller than `maxDim`
- [x] Draw to a `<canvas>` sized to the computed dimensions; export via `canvas.toBlob((blob) => resolve(blob), 'image/webp', opts?.quality ?? 0.8)`
- [x] Outer try/catch: any exception (image decode failure, canvas tainted by CORS, toBlob unsupported) resolves to `null`
- [x] JSDoc above the export explaining the return-null contract + intended use from the upload hook

## Phase B: Verify

- [x] `pnpm type-check` passes (three pre-existing errors only)
- [x] Manual smoke: start dev server, paste a devtools snippet loading a local image via `File` constructor or picker, call the utility, confirm the returned `Blob` has `type === 'image/webp'` and its pixel dimensions fit inside 200×200 (via `URL.createObjectURL(blob) → new Image() → naturalWidth/Height`)
- [x] Non-image path: call with a text `File` — confirm `null` return (no exception)

---

## Plane IDs (populated by /pp)

Phase A: AHR-1802
- Task 1: AHR-1803
- Task 2: AHR-1804
- Task 3: AHR-1805
- Task 4: AHR-1806
- Task 5: AHR-1807
- Task 6: AHR-1808
- Task 7: AHR-1809

Phase B: AHR-1810
- Task 1: AHR-1811
- Task 2: AHR-1812
- Task 3: AHR-1813
