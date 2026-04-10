-- ============================================
-- ORG-FILES STORAGE BUCKET + RLS
-- ============================================

-- PHASE 1: CREATE BUCKET
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-files', 'org-files', false);

-- PHASE 2: RLS POLICIES ON storage.objects
-- Org members can read files under their organization's path prefix
CREATE POLICY "org_members_can_select_org_files"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'org-files'
        AND public.is_org_member((storage.foldername(name))[1])
    );

-- Admin/owner can upload files under their organization's path prefix
CREATE POLICY "org_admin_can_insert_org_files"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'org-files'
        AND public.is_admin_or_owner((storage.foldername(name))[1])
    );

-- Admin/owner can update files under their organization's path prefix
CREATE POLICY "org_admin_can_update_org_files"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'org-files'
        AND public.is_admin_or_owner((storage.foldername(name))[1])
    );

-- Admin/owner can delete files under their organization's path prefix
CREATE POLICY "org_admin_can_delete_org_files"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'org-files'
        AND public.is_admin_or_owner((storage.foldername(name))[1])
    );
