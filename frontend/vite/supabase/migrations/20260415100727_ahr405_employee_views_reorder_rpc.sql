-- ============================================
-- AHR-405: REORDER employee_views ATOMICALLY
-- ============================================
-- Single-call replacement for an array of view ids in their new order.
-- Renumbers them to (idx+1)*100 so the integer space stays clean across drags.
-- All ids must belong to the same org; caller must be admin/owner of that org.
-- ============================================

CREATE OR REPLACE FUNCTION public.reorder_employee_views(p_ids TEXT[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id TEXT;
    v_input_count INTEGER := COALESCE(array_length(p_ids, 1), 0);
    v_match_count INTEGER;
    v_distinct_orgs INTEGER;
    v_idx INTEGER;
BEGIN
    IF v_input_count = 0 THEN
        RETURN;
    END IF;

    -- All ids must belong to the same org (and exist)
    SELECT COUNT(*), COUNT(DISTINCT organization_id)
        INTO v_match_count, v_distinct_orgs
    FROM public.employee_views
    WHERE id = ANY(p_ids);

    IF v_match_count <> v_input_count THEN
        RAISE EXCEPTION 'reorder_employee_views: input contains unknown view ids';
    END IF;
    IF v_distinct_orgs > 1 THEN
        RAISE EXCEPTION 'reorder_employee_views: ids span multiple organizations';
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.employee_views
    WHERE id = p_ids[1];

    IF NOT public.is_admin_or_owner(v_org_id) THEN
        RAISE EXCEPTION 'reorder_employee_views: not authorized for organization %', v_org_id;
    END IF;

    FOR v_idx IN 1..v_input_count LOOP
        UPDATE public.employee_views
        SET sort_order = v_idx * 100, updated_at = now()
        WHERE id = p_ids[v_idx];
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_employee_views(TEXT[]) TO authenticated;
