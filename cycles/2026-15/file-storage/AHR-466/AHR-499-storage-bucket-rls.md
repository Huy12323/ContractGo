# [v0.0.1 | File Storage] Supabase Storage setup > Storage bucket + RLS

Work Item: [AHR-499](https://plane.jimbui.dev/aiur/browse/AHR-499/)
Tier 1: [AHR-466] [v0.0.1 | File Storage] Supabase Storage setup (Todo)
Module: [File Storage](https://plane.jimbui.dev/aiur/projects/53594a97-bd1d-4d52-bcb9-ebacadc41464/modules/afc946b0-595e-4b71-b197-96ef3fa58f28/)
Outline Spec: https://outline.jimbui.dev/doc/9a18c1f7-a383-4c07-a3ba-d5ef2ed65034
Version Doc: https://outline.jimbui.dev/doc/bab31499-0cd5-4d49-a6c1-7d7af119f63d

## Context (from spec)

Non-tech: File Storage handles secure file uploads and serving for the platform. v0.0.1 uses Supabase Storage with org-scoped RLS. Each org's files are isolated — no cross-org access.
Tech: Single `org-files` bucket, RLS on `storage.objects` using `is_org_member()` / `is_admin_or_owner()`. Path: `{organization_id}/contracts/{contract_id}/signed.pdf|signature.png`.
Related: [Employee Onboarding](https://outline.jimbui.dev/doc/578b77dd-4a2f-4a0a-b644-ccdba3c0cc9b) — consumes signed contract PDFs and signature images. [Organization](https://outline.jimbui.dev/doc/e6b6950b-efe9-4770-a65c-cc8ec0184aa9) — org-level file isolation.
Siblings: 1 total, 0 Done — [AHR-499 Storage bucket + RLS (Todo)]
Execution Order: Step 1 of 1 — standalone, no dependencies ✓

## Phase A: Storage Bucket + RLS Migration

- [x] Create migration: `org-files` bucket (INSERT INTO storage.buckets, private) + RLS policies on storage.objects (SELECT → is_org_member, INSERT/UPDATE/DELETE → is_admin_or_owner, all using path-based org_id extraction via storage.foldername)
- [x] Apply migration locally (supabase db push --local) and lint (supabase db lint --local)
- [x] Regenerate TypeScript types (pnpm sb:dev:types)

---

## Plane IDs (populated by /pp)

Phase A: AHR-500

- Task 1: AHR-501
- Task 2: AHR-502
- Task 3: AHR-503
