-- ============================================
-- Fix clean_employee_views_on_column_delete() after AHR-941 split employee_views.config
-- ============================================
-- AHR-405 added an AFTER DELETE trigger on employee_columns that rewrote
-- employee_views.config (a single JSONB blob). AHR-941 later dropped that
-- column and split it into per-key columns: field_order, hidden_keys, sort,
-- group_by, filter, field_widths. The trigger was never updated, so every
-- DELETE on employee_columns now errors with 'column "config" does not exist'
-- and rolls back — the user-facing "Delete field" action silently fails.
--
-- Additionally, filter is now a flat array of condition objects
-- (EmployeeTable_FilterCondition[]), not the old kind='condition'/'group' tree,
-- so the recursive filter-node walker is obsolete.
-- ============================================

DROP FUNCTION IF EXISTS public.clean_employee_view_filter_node(JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.clean_employee_views_on_column_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.employee_views v
    SET
        field_order = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements_text(v.field_order) AS elem
            WHERE elem <> OLD.id
        ), '[]'::jsonb),
        hidden_keys = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements_text(v.hidden_keys) AS elem
            WHERE elem <> OLD.id
        ), '[]'::jsonb),
        sort = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(v.sort) AS elem
            WHERE elem->>'field' <> OLD.id
        ), '[]'::jsonb),
        group_by = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(v.group_by) AS elem
            WHERE elem->>'field' <> OLD.id
        ), '[]'::jsonb),
        filter = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(v.filter) AS elem
            WHERE elem->>'field' <> OLD.id
        ), '[]'::jsonb),
        updated_at = now()
    WHERE v.organization_id = OLD.organization_id;

    RETURN OLD;
END;
$$;
