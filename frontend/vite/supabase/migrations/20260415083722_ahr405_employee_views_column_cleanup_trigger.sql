-- ============================================
-- AHR-405: CLEAN employee_views.config WHEN AN employee_columns ROW IS DELETED
-- ============================================
-- Strips references to the deleted column id from every saved view in the
-- same organization. Mirrors the client-side Utils_EmployeeView_CleanConfig:
--   * fieldOrder[]   — drop matching string entries
--   * hiddenKeys[]   — drop matching string entries
--   * sort[].field   — drop matching entries
--   * groupBy[].field— drop matching entries
--   * filter (tree)  — drop condition nodes whose field matches; prune empty groups
-- ============================================

-- Recursive helper: walk a filter node, return cleaned node or NULL when fully pruned
CREATE OR REPLACE FUNCTION public.clean_employee_view_filter_node(node JSONB, deleted_field TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cleaned_children JSONB := '[]'::jsonb;
    child JSONB;
    new_child JSONB;
BEGIN
    IF node IS NULL OR jsonb_typeof(node) = 'null' THEN
        RETURN NULL;
    END IF;

    IF node->>'kind' = 'condition' THEN
        IF node->>'field' = deleted_field THEN
            RETURN NULL;
        END IF;
        RETURN node;
    END IF;

    -- group node — recurse into children
    FOR child IN SELECT * FROM jsonb_array_elements(node->'children') LOOP
        new_child := public.clean_employee_view_filter_node(child, deleted_field);
        IF new_child IS NOT NULL THEN
            cleaned_children := cleaned_children || jsonb_build_array(new_child);
        END IF;
    END LOOP;

    IF jsonb_array_length(cleaned_children) = 0 THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_set(node, '{children}', cleaned_children);
END;
$$;

-- Trigger function: rewrite every view in the deleted column's org
CREATE OR REPLACE FUNCTION public.clean_employee_views_on_column_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    view_row RECORD;
    cleaned_config JSONB;
    new_field_order JSONB;
    new_hidden_keys JSONB;
    new_sort JSONB;
    new_group_by JSONB;
    new_filter JSONB;
BEGIN
    FOR view_row IN
        SELECT id, config FROM public.employee_views
        WHERE organization_id = OLD.organization_id
    LOOP
        cleaned_config := view_row.config;

        IF cleaned_config ? 'fieldOrder' THEN
            SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO new_field_order
            FROM jsonb_array_elements_text(cleaned_config->'fieldOrder') AS elem
            WHERE elem <> OLD.id;
            cleaned_config := jsonb_set(cleaned_config, '{fieldOrder}', new_field_order);
        END IF;

        IF cleaned_config ? 'hiddenKeys' THEN
            SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO new_hidden_keys
            FROM jsonb_array_elements_text(cleaned_config->'hiddenKeys') AS elem
            WHERE elem <> OLD.id;
            cleaned_config := jsonb_set(cleaned_config, '{hiddenKeys}', new_hidden_keys);
        END IF;

        IF cleaned_config ? 'sort' THEN
            SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO new_sort
            FROM jsonb_array_elements(cleaned_config->'sort') AS elem
            WHERE elem->>'field' <> OLD.id;
            cleaned_config := jsonb_set(cleaned_config, '{sort}', new_sort);
        END IF;

        IF cleaned_config ? 'groupBy' THEN
            SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO new_group_by
            FROM jsonb_array_elements(cleaned_config->'groupBy') AS elem
            WHERE elem->>'field' <> OLD.id;
            cleaned_config := jsonb_set(cleaned_config, '{groupBy}', new_group_by);
        END IF;

        IF cleaned_config ? 'filter' AND jsonb_typeof(cleaned_config->'filter') <> 'null' THEN
            new_filter := public.clean_employee_view_filter_node(cleaned_config->'filter', OLD.id);
            cleaned_config := jsonb_set(cleaned_config, '{filter}', COALESCE(new_filter, 'null'::jsonb));
        END IF;

        UPDATE public.employee_views
        SET config = cleaned_config, updated_at = now()
        WHERE id = view_row.id;
    END LOOP;

    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_clean_employee_views_on_column_delete
    AFTER DELETE ON public.employee_columns
    FOR EACH ROW
    EXECUTE FUNCTION public.clean_employee_views_on_column_delete();
