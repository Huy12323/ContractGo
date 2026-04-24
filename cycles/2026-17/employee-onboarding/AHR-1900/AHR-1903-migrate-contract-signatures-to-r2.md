# [v0.0.2 | Employee Onboarding] Migrate contract signatures to R2 > Edge functions + frontend + backfill

Work Item: AHR-1903 (https://plane.jimbui.dev/aiur/browse/AHR-1903/)
Parent T1: AHR-1900 (https://plane.jimbui.dev/aiur/browse/AHR-1900/)
Module: Employee Onboarding
Cycle: 2026/17
Estimate: 5 pts

## Context

Contract signature PNGs were the last surface still on Supabase Storage (`org-files` bucket) while every other file type (contract PDFs, employee_col, invitation_col, user avatars) had already moved to Cloudflare R2. This migration unifies storage on R2 and lets us retire the bucket + its RLS policies entirely.

## Phases

### Phase A: Edge function migration

- [x] Add R2 SDK to `submit-contract/deno.json` and switch the signature upload + rollback to `PutObjectCommand` / `DeleteObjectCommand`. New key format `orgs/{org_id}/contracts/{contract_id}/signature-{ts}.png`
- [x] Add R2 SDK to `request-changes/deno.json` and switch the signature delete to `DeleteObjectCommand`
- [x] Extend `files_r2_sign-read-url/index.ts` with `contract_signature` resource_type — looks up `contracts.signature_path`, dual-auth (invitation recipient OR org admin/owner), signs JWT

### Phase B: Frontend wire-up

- [x] `App_OnboardingReviewModal.tsx` — swap `supabase.storage.from('org-files').createSignedUrl` for `supabase.functions.invoke('files_r2_sign-read-url', { body: { resource_type: 'contract_signature', contract_id } })`

### Phase C: Backfill + bucket retirement

- [x] New `scripts/backfill-signatures-to-r2.js` — for each `contracts` row with legacy `signature_path` (not starting with `orgs/`), downloads from Supabase Storage, uploads to R2 at the new key, UPDATEs `signature_path`. Idempotent. `--dry-run` + `--delete-source` flags
- [x] Run backfill with `--delete-source` (8 signatures migrated)
- [x] Drop `org-files` bucket via Supabase Storage API + drop RLS policies via migration `20260424140000_drop_org_files_storage_bucket.sql`

### Phase D: Verify

- [x] type-check passes
- [x] Grep confirms zero `supabase.storage` / `org-files` references in production code

## Plane IDs

- T1: AHR-1900
- T2: AHR-1903
- Phase A: AHR-1905
  - Task A1: AHR-1911 (submit-contract PutObjectCommand)
  - Task A2: AHR-1913 (request-changes DeleteObjectCommand)
  - Task A3: AHR-1914 (contract_signature resource_type)
- Phase B: AHR-1915
  - Task B1: AHR-1918 (review modal swap)
- Phase C: AHR-1921
  - Task C1: AHR-1924 (backfill script)
  - Task C2: AHR-1925 (run backfill — 8 signatures)
  - Task C3: AHR-1926 (drop bucket + RLS migration)
- Phase D: AHR-1928
  - Task D1: AHR-1933 (type-check)
  - Task D2: AHR-1935 (grep verification)
