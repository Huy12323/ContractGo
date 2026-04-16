-- ============================================
-- AHR-405: ADD sort_order TO employee_views
-- ============================================
-- Sparse integer ordering (100, 200, 300, ...) — leaves room for inserts
-- without renormalization. Drag-to-reorder calls reorder_employee_views()
-- which renumbers all rows in an org to clean (idx+1)*100 values.
-- ============================================

ALTER TABLE public.employee_views
    ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows: per-org, ordered by created_at, sort_order = ROW_NUMBER * 100
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at ASC) * 100 AS new_sort_order
    FROM public.employee_views
)
UPDATE public.employee_views ev
SET sort_order = ranked.new_sort_order
FROM ranked
WHERE ev.id = ranked.id;

CREATE INDEX idx_employee_views_org_sort ON public.employee_views(organization_id, sort_order);
