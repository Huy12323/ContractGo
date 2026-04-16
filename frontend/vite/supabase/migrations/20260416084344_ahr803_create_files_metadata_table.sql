-- ============================================
-- FILES METADATA TABLE + RLS (R2-backed)
-- ============================================
--
-- Pairs every R2 object with an auditable DB row.
-- Two row scopes distinguished by organization_id:
--   - Org-scope (organization_id NOT NULL): contracts, employee column files
--   - User-scope (organization_id IS NULL): user avatars
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.files (
    id TEXT PRIMARY KEY DEFAULT generate_id('fil'),
    r2_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size BIGINT NOT NULL,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_files_organization_id ON public.files(organization_id);
CREATE INDEX idx_files_uploaded_by ON public.files(uploaded_by);

-- PHASE 2: updated_at trigger
CREATE TRIGGER on_files_updated
    BEFORE UPDATE ON public.files
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- PHASE 3: RLS — branching on organization_id IS NULL
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- SELECT: org members read org-scope rows
CREATE POLICY "org_members_can_view_org_scope_files"
    ON public.files FOR SELECT TO authenticated
    USING (
        organization_id IS NOT NULL
        AND public.is_org_member(organization_id)
    );

-- SELECT: any authenticated user reads user-scope rows
CREATE POLICY "authenticated_can_view_user_scope_files"
    ON public.files FOR SELECT TO authenticated
    USING (organization_id IS NULL);

-- INSERT: admin/owner inserts org-scope rows
CREATE POLICY "admin_or_owner_can_insert_org_scope_files"
    ON public.files FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IS NOT NULL
        AND public.is_admin_or_owner(organization_id)
    );

-- INSERT: authenticated user inserts their own user-scope row
CREATE POLICY "uploader_can_insert_user_scope_files"
    ON public.files FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IS NULL
        AND uploaded_by = (SELECT auth.uid())
    );

-- UPDATE: admin/owner updates org-scope rows
CREATE POLICY "admin_or_owner_can_update_org_scope_files"
    ON public.files FOR UPDATE TO authenticated
    USING (
        organization_id IS NOT NULL
        AND public.is_admin_or_owner(organization_id)
    );

-- UPDATE: uploader updates their own user-scope row
CREATE POLICY "uploader_can_update_user_scope_files"
    ON public.files FOR UPDATE TO authenticated
    USING (
        organization_id IS NULL
        AND uploaded_by = (SELECT auth.uid())
    );

-- DELETE: admin/owner deletes org-scope rows
CREATE POLICY "admin_or_owner_can_delete_org_scope_files"
    ON public.files FOR DELETE TO authenticated
    USING (
        organization_id IS NOT NULL
        AND public.is_admin_or_owner(organization_id)
    );

-- DELETE: uploader deletes their own user-scope row
CREATE POLICY "uploader_can_delete_user_scope_files"
    ON public.files FOR DELETE TO authenticated
    USING (
        organization_id IS NULL
        AND uploaded_by = (SELECT auth.uid())
    );
