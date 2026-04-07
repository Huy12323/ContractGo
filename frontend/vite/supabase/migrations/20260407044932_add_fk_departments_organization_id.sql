-- ============================================
-- ADD FK ON departments.organization_id
-- Bible convention: child tables include FK on organization_id alongside trigger pattern
-- ============================================

-- PHASE 1: VALIDATE — no orphan organization_id values
DO $$
DECLARE
    orphan_count integer;
BEGIN
    SELECT count(*) INTO orphan_count
    FROM public.departments d
    WHERE d.organization_id != ''
      AND NOT EXISTS (
        SELECT 1 FROM public.organizations o WHERE o.id = d.organization_id
      );

    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'Found % department(s) with orphan organization_id — fix data before adding FK', orphan_count;
    END IF;
END;
$$;

-- PHASE 2: ADD FK CONSTRAINT
ALTER TABLE public.departments
    ADD CONSTRAINT departments_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;
