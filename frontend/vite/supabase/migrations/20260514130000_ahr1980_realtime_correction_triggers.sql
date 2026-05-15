-- ============================================
-- AHR-1980: Realtime triggers for correction approval tables
-- Adds correction_tasks, timeclock_corrections, and rel__correction_task__department
-- to the org-id resolver + attaches the generic realtime trigger.
-- entities already has a trigger, so correction_approval_mode changes are covered.
-- ============================================

-- PHASE 1: Extend org-id resolver with correction tables
CREATE OR REPLACE FUNCTION public.get_organization_id_for_change(
    p_table_name TEXT,
    p_record_data JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    org_id TEXT;
BEGIN
    CASE p_table_name
        WHEN 'organizations' THEN
            org_id := p_record_data->>'id';

        WHEN 'entities', 'admins', 'employees', 'departments',
             'contract_templates', 'contracts',
             'employee_columns', 'employee_column_choices', 'employee_views',
             'onboarding_invitations', 'files', 'admin_invitations',
             'correction_tasks', 'timeclock_corrections' THEN
            org_id := p_record_data->>'organization_id';

        WHEN 'rel__department__employee' THEN
            SELECT d.organization_id INTO org_id
            FROM public.departments d
            WHERE d.id = p_record_data->>'department_id';

        WHEN 'rel__department__invitation' THEN
            SELECT oi.organization_id INTO org_id
            FROM public.onboarding_invitations oi
            WHERE oi.id = p_record_data->>'invitation_id';

        WHEN 'rel__correction_task__department' THEN
            SELECT d.organization_id INTO org_id
            FROM public.departments d
            WHERE d.id = p_record_data->>'department_id';

        ELSE
            RAISE WARNING 'get_organization_id_for_change: unknown table %', p_table_name;
            RETURN NULL;
    END CASE;

    RETURN org_id;
END;
$$;

-- PHASE 2: Attach triggers
CREATE TRIGGER trg_notify_realtime_correction_tasks
    AFTER INSERT OR UPDATE OR DELETE ON public.correction_tasks
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_timeclock_corrections
    AFTER INSERT OR UPDATE OR DELETE ON public.timeclock_corrections
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();

CREATE TRIGGER trg_notify_realtime_rel__correction_task__department
    AFTER INSERT OR UPDATE OR DELETE ON public.rel__correction_task__department
    FOR EACH ROW EXECUTE FUNCTION public.notify_organization_of_table_change();
