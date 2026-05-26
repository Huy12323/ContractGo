-- ============================================
-- AHR-1990: Folders table + data migration
-- Adds a lightweight folder grouping layer between
-- file-type employee column cells and files.
-- ============================================

-- PHASE 1: CREATE FOLDERS TABLE
CREATE TABLE public.folders (
    id TEXT PRIMARY KEY DEFAULT generate_id('fol'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_folders_organization_id ON public.folders(organization_id);

CREATE TRIGGER on_folders_updated
    BEFORE UPDATE ON public.folders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- PHASE 2: RLS
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_folders"
    ON public.folders FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "admin_or_owner_can_insert_folders"
    ON public.folders FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_folders"
    ON public.folders FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_folders"
    ON public.folders FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- PHASE 3: ADD folder_id TO files
ALTER TABLE public.files ADD COLUMN folder_id TEXT REFERENCES public.folders(id) ON DELETE CASCADE;
CREATE INDEX idx_files_folder_id ON public.files(folder_id);

-- PHASE 4: DATA MIGRATION
-- Wrap each existing file-type cell value in a folder.
-- Cell value changes from files.id → folders.id.
DO $$
DECLARE
    col RECORD;
    row_data RECORD;
    new_folder_id TEXT;
    entity_table TEXT;
    file_org_id TEXT;
BEGIN
    FOR col IN
        SELECT id, entity_id FROM public.employee_columns WHERE type = 'file'
    LOOP
        entity_table := 'ent_' || col.entity_id || '__employees';

        IF NOT EXISTS (
            SELECT 1 FROM pg_class
            WHERE relname = entity_table AND relnamespace = 'public'::regnamespace
        ) THEN
            CONTINUE;
        END IF;

        FOR row_data IN
            EXECUTE format(
                'SELECT employee_id, %I AS file_id FROM public.%I WHERE %I IS NOT NULL',
                col.id, entity_table, col.id
            )
        LOOP
            SELECT organization_id INTO file_org_id
            FROM public.files WHERE id = row_data.file_id;

            IF file_org_id IS NULL THEN
                CONTINUE;
            END IF;

            INSERT INTO public.folders (organization_id)
            VALUES (file_org_id)
            RETURNING id INTO new_folder_id;

            UPDATE public.files
            SET folder_id = new_folder_id
            WHERE id = row_data.file_id;

            EXECUTE format(
                'UPDATE public.%I SET %I = $1 WHERE employee_id = $2',
                entity_table, col.id
            )
            USING new_folder_id, row_data.employee_id;
        END LOOP;
    END LOOP;
END
$$;
