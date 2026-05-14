-- ============================================
-- AHR-1981: Entity correction approval settings
-- Adds per-entity approval mode + default department flag + backfill
-- ============================================

-- PHASE 1: Approval mode enum + column on entities
CREATE TYPE public.entities_correction_approval_mode_enum AS ENUM ('hr_only', 'manager_only', 'both');

ALTER TABLE public.entities
    ADD COLUMN correction_approval_mode public.entities_correction_approval_mode_enum NOT NULL DEFAULT 'hr_only';

-- PHASE 2: Default department flag
ALTER TABLE public.departments
    ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_departments_entity_default
    ON public.departments(entity_id) WHERE is_default = true;

-- PHASE 3: Backfill — mark oldest department as default for entities that have departments
UPDATE public.departments d
SET is_default = true
FROM (
    SELECT DISTINCT ON (entity_id) id
    FROM public.departments
    ORDER BY entity_id, created_at ASC
) oldest
WHERE d.id = oldest.id;

-- PHASE 4: Backfill — create "General" default department for entities without any departments
-- The set_org_id_from_entity trigger auto-populates organization_id
INSERT INTO public.departments (entity_id, name, is_default)
SELECT e.id, 'General', true
FROM public.entities e
WHERE NOT EXISTS (
    SELECT 1 FROM public.departments d WHERE d.entity_id = e.id
);

-- PHASE 5: Backfill — assign unassigned employees to their entity's default department
INSERT INTO public.rel__department__employee (department_id, employee_id)
SELECT d.id, emp.id
FROM public.employees emp
JOIN public.departments d ON d.entity_id = emp.entity_id AND d.is_default = true
WHERE NOT EXISTS (
    SELECT 1 FROM public.rel__department__employee rde WHERE rde.employee_id = emp.id
);
