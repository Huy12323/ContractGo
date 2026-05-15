-- ============================================
-- AHR-1980: Per-department decision tracking
-- Replace approved_by/approved_at with decision/decided_by/decided_at
-- on rel__correction_task__department.
-- ============================================

-- 1. Create decision enum
CREATE TYPE public.correction_dept_decision_enum AS ENUM ('approved', 'rejected');

-- 2. Add new columns
ALTER TABLE public.rel__correction_task__department
    ADD COLUMN decision public.correction_dept_decision_enum,
    ADD COLUMN decided_by UUID REFERENCES public.profiles(id),
    ADD COLUMN decided_at TIMESTAMPTZ;

-- 3. Migrate existing data
UPDATE public.rel__correction_task__department
SET decision = 'approved',
    decided_by = approved_by,
    decided_at = approved_at
WHERE approved_by IS NOT NULL;

-- 4. Drop old columns
ALTER TABLE public.rel__correction_task__department
    DROP COLUMN approved_by,
    DROP COLUMN approved_at;

-- 5. Update approve_correction_task RPC
CREATE OR REPLACE FUNCTION public.approve_correction_task(p_correction_task_id text, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid;
    v_task record;
    v_entity record;
    v_is_hr boolean;
    v_is_manager boolean;
    v_manager_dept_id text;
    v_all_depts_decided boolean;
    v_any_rejected boolean;
    v_has_departments boolean;
    v_new_status text;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    SELECT * INTO v_task FROM public.correction_tasks WHERE id = p_correction_task_id;
    IF v_task IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Correction task not found');
    END IF;

    SELECT correction_approval_mode INTO v_entity
    FROM public.entities WHERE id = v_task.entity_id;

    v_is_hr := public.is_admin_or_owner(v_task.organization_id);

    SELECT mgr.department_id INTO v_manager_dept_id
    FROM public.rel__correction_task__department rctd
    JOIN public.rel__department__employee mgr ON mgr.department_id = rctd.department_id
    JOIN public.employees e ON e.id = mgr.employee_id
    WHERE rctd.correction_task_id = p_correction_task_id
      AND mgr.is_manager = true
      AND e.user_id = v_caller_id
    LIMIT 1;

    v_is_manager := v_manager_dept_id IS NOT NULL;

    SELECT EXISTS (
        SELECT 1 FROM public.rel__correction_task__department
        WHERE correction_task_id = p_correction_task_id
    ) INTO v_has_departments;

    IF NOT v_is_hr AND NOT v_is_manager THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authorized to act on this correction');
    END IF;

    -- === REJECT ===
    IF p_action = 'reject' THEN
        IF v_task.status NOT IN ('pending', 'manager_approved') THEN
            RETURN jsonb_build_object('success', false, 'message', 'Cannot reject: status is ' || v_task.status);
        END IF;

        -- Record per-department rejection for manager
        IF v_is_manager THEN
            UPDATE public.rel__correction_task__department
            SET decision = 'rejected', decided_by = v_caller_id, decided_at = now()
            WHERE correction_task_id = p_correction_task_id
              AND department_id IN (
                  SELECT mgr.department_id
                  FROM public.rel__department__employee mgr
                  JOIN public.employees e ON e.id = mgr.employee_id
                  WHERE mgr.is_manager = true AND e.user_id = v_caller_id
              )
              AND decision IS NULL;
        END IF;

        UPDATE public.correction_tasks
        SET status = 'rejected',
            rejected_by = v_caller_id,
            rejected_at = now(),
            updated_at = now()
        WHERE id = p_correction_task_id;

        RETURN jsonb_build_object('success', true, 'new_status', 'rejected', 'message', 'Correction rejected');
    END IF;

    -- === APPROVE ===
    IF p_action != 'approve' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid action: ' || p_action);
    END IF;

    -- No departments linked (submitted before mode change) — HR can approve directly
    IF NOT v_has_departments AND v_task.status = 'pending' THEN
        IF NOT v_is_hr THEN
            RETURN jsonb_build_object('success', false, 'message', 'No departments linked — only HR can approve');
        END IF;

        UPDATE public.correction_tasks
        SET status = 'approved',
            approved_by = v_caller_id,
            approved_at = now(),
            updated_at = now()
        WHERE id = p_correction_task_id;

        RETURN jsonb_build_object('success', true, 'new_status', 'approved', 'message', 'Correction approved (no departments linked)');
    END IF;

    -- hr_only mode
    IF v_entity.correction_approval_mode = 'hr_only' THEN
        IF NOT v_is_hr THEN
            RETURN jsonb_build_object('success', false, 'message', 'Only HR can approve in hr_only mode');
        END IF;
        IF v_task.status != 'pending' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Cannot approve: status is ' || v_task.status);
        END IF;

        UPDATE public.correction_tasks
        SET status = 'approved',
            approved_by = v_caller_id,
            approved_at = now(),
            updated_at = now()
        WHERE id = p_correction_task_id;

        RETURN jsonb_build_object('success', true, 'new_status', 'approved', 'message', 'Correction approved');
    END IF;

    -- manager_only mode
    IF v_entity.correction_approval_mode = 'manager_only' THEN
        IF NOT v_is_manager THEN
            RETURN jsonb_build_object('success', false, 'message', 'Only managers can approve in manager_only mode');
        END IF;
        IF v_task.status != 'pending' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Cannot approve: status is ' || v_task.status);
        END IF;

        UPDATE public.rel__correction_task__department
        SET decision = 'approved', decided_by = v_caller_id, decided_at = now()
        WHERE correction_task_id = p_correction_task_id
          AND department_id IN (
              SELECT mgr.department_id
              FROM public.rel__department__employee mgr
              JOIN public.employees e ON e.id = mgr.employee_id
              WHERE mgr.is_manager = true AND e.user_id = v_caller_id
          )
          AND decision IS NULL;

        SELECT NOT EXISTS (
            SELECT 1 FROM public.rel__correction_task__department
            WHERE correction_task_id = p_correction_task_id AND decision IS NULL
        ) INTO v_all_depts_decided;

        SELECT EXISTS (
            SELECT 1 FROM public.rel__correction_task__department
            WHERE correction_task_id = p_correction_task_id AND decision = 'rejected'
        ) INTO v_any_rejected;

        IF v_any_rejected THEN
            UPDATE public.correction_tasks
            SET status = 'rejected', rejected_by = v_caller_id, rejected_at = now(), updated_at = now()
            WHERE id = p_correction_task_id;
            RETURN jsonb_build_object('success', true, 'new_status', 'rejected', 'message', 'Correction rejected by a department');
        END IF;

        IF v_all_depts_decided THEN
            UPDATE public.correction_tasks
            SET status = 'approved',
                approved_by = v_caller_id,
                approved_at = now(),
                updated_at = now()
            WHERE id = p_correction_task_id;
            v_new_status := 'approved';
        ELSE
            UPDATE public.correction_tasks SET updated_at = now() WHERE id = p_correction_task_id;
            v_new_status := 'pending';
        END IF;

        RETURN jsonb_build_object('success', true, 'new_status', v_new_status, 'message',
            CASE WHEN v_all_depts_decided THEN 'All managers approved — correction approved'
                 ELSE 'Department approved — awaiting other managers' END);
    END IF;

    -- both mode
    IF v_entity.correction_approval_mode = 'both' THEN
        -- Manager approving
        IF v_is_manager AND v_task.status = 'pending' THEN
            UPDATE public.rel__correction_task__department
            SET decision = 'approved', decided_by = v_caller_id, decided_at = now()
            WHERE correction_task_id = p_correction_task_id
              AND department_id IN (
                  SELECT mgr.department_id
                  FROM public.rel__department__employee mgr
                  JOIN public.employees e ON e.id = mgr.employee_id
                  WHERE mgr.is_manager = true AND e.user_id = v_caller_id
              )
              AND decision IS NULL;

            SELECT NOT EXISTS (
                SELECT 1 FROM public.rel__correction_task__department
                WHERE correction_task_id = p_correction_task_id AND decision IS NULL
            ) INTO v_all_depts_decided;

            SELECT EXISTS (
                SELECT 1 FROM public.rel__correction_task__department
                WHERE correction_task_id = p_correction_task_id AND decision = 'rejected'
            ) INTO v_any_rejected;

            IF v_any_rejected THEN
                UPDATE public.correction_tasks
                SET status = 'rejected', rejected_by = v_caller_id, rejected_at = now(), updated_at = now()
                WHERE id = p_correction_task_id;
                RETURN jsonb_build_object('success', true, 'new_status', 'rejected', 'message', 'Correction rejected by a department');
            END IF;

            IF v_all_depts_decided THEN
                UPDATE public.correction_tasks
                SET status = 'manager_approved', updated_at = now()
                WHERE id = p_correction_task_id;
                v_new_status := 'manager_approved';
            ELSE
                UPDATE public.correction_tasks SET updated_at = now() WHERE id = p_correction_task_id;
                v_new_status := 'pending';
            END IF;

            RETURN jsonb_build_object('success', true, 'new_status', v_new_status, 'message',
                CASE WHEN v_all_depts_decided THEN 'All managers approved — awaiting HR'
                     ELSE 'Department approved — awaiting other managers' END);
        END IF;

        -- HR final approval
        IF v_is_hr AND v_task.status = 'manager_approved' THEN
            UPDATE public.correction_tasks
            SET status = 'approved',
                approved_by = v_caller_id,
                approved_at = now(),
                updated_at = now()
            WHERE id = p_correction_task_id;

            RETURN jsonb_build_object('success', true, 'new_status', 'approved', 'message', 'Correction fully approved');
        END IF;

        RETURN jsonb_build_object('success', false, 'message',
            'Cannot approve: current status is ' || v_task.status || ', your role does not match the required next step');
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unknown approval mode');
END;
$$;
