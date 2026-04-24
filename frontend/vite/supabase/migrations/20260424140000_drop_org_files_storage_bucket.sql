-- ============================================
-- DROP ORG-FILES STORAGE BUCKET (signatures migrated to R2)
-- ============================================
-- All file storage now lives on Cloudflare R2:
--   * Employee-column files / contract PDFs / user avatars / contract
--     signatures all flow through `files_r2_*` edge functions.
--
-- The `org-files` Supabase Storage bucket previously held contract signature
-- PNGs. They've been migrated to R2 via scripts/backfill-signatures-to-r2.js
-- (signature_path values now start with `orgs/...`). With the bucket no longer
-- referenced from production code, drop it + its RLS policies + any remaining
-- objects in one shot.
--
-- This migration is destructive for any leftover Supabase Storage objects under
-- this bucket — verify backfill ran cleanly first (the script is idempotent and
-- the second pass should report `0 legacy`).
-- ============================================

-- PHASE 1: Drop RLS policies on storage.objects scoped to this bucket
DROP POLICY IF EXISTS "org_members_can_select_org_files" ON storage.objects;
DROP POLICY IF EXISTS "org_admin_can_insert_org_files" ON storage.objects;
DROP POLICY IF EXISTS "org_admin_can_update_org_files" ON storage.objects;
DROP POLICY IF EXISTS "org_admin_can_delete_org_files" ON storage.objects;

-- The bucket itself is dropped via the Storage API (Supabase blocks direct
-- DELETE on storage.buckets / storage.objects). One-shot deletion runs as
-- part of the migration PR — see scripts/backfill-signatures-to-r2.js for
-- the data move and the PR description for the bucket deletion command.
