-- ============================================
-- AHR-1980: Correction Approval Workflow
-- Multi-department manager approval + HR final approval
-- ============================================

-- PHASE 1: Add manager_approved status to correction_task_status_enum
ALTER TYPE public.correction_task_status_enum ADD VALUE 'manager_approved' AFTER 'pending';

-- PHASE 2: Create rel__correction_task__department junction table
-- Links correction tasks to departments for per-department manager approval.
-- No organization_id: derived via FK parent (correction_tasks → organization_id).

CREATE TABLE public.rel__correction_task__department (
    correction_task_id TEXT NOT NULL REFERENCES public.correction_tasks(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    approved_by UUID REFERENCES public.profiles(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (correction_task_id, department_id)
);

CREATE INDEX idx_rel_ctd_correction_task_id ON public.rel__correction_task__department(correction_task_id);
CREATE INDEX idx_rel_ctd_department_id ON public.rel__correction_task__department(department_id);

ALTER TABLE public.rel__correction_task__department ENABLE ROW LEVEL SECURITY;

-- Admin/owner CRUD via correction_tasks parent
CREATE POLICY "admin_or_owner_can_view_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_insert_rel__correction_task__department"
    ON public.rel__correction_task__department FOR INSERT TO authenticated
    WITH CHECK (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_update_rel__correction_task__department"
    ON public.rel__correction_task__department FOR UPDATE TO authenticated
    USING (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

CREATE POLICY "admin_or_owner_can_delete_rel__correction_task__department"
    ON public.rel__correction_task__department FOR DELETE TO authenticated
    USING (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE public.is_admin_or_owner(organization_id)
        )
    );

-- Employee can view junction rows for their own correction tasks
CREATE POLICY "employee_can_view_own_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE employee_id IN (
                SELECT id FROM public.employees
                WHERE user_id = (SELECT auth.uid())
            )
        )
    );

-- Employee can insert junction rows for their own correction tasks
CREATE POLICY "employee_can_insert_own_rel__correction_task__department"
    ON public.rel__correction_task__department FOR INSERT TO authenticated
    WITH CHECK (
        correction_task_id IN (
            SELECT id FROM public.correction_tasks
            WHERE employee_id IN (
                SELECT id FROM public.employees
                WHERE user_id = (SELECT auth.uid())
            )
        )
    );

-- Manager can view junction rows for departments they manage
-- Optimized: resolve managed departments first (small set), then filter
CREATE POLICY "manager_can_view_rel__correction_task__department"
    ON public.rel__correction_task__department FOR SELECT TO authenticated
    USING (
        department_id IN (
            SELECT mgr.department_id
            FROM public.rel__department__employee mgr
            JOIN public.employees e ON e.id = mgr.employee_id
            WHERE mgr.is_manager = true AND e.user_id = (SELECT auth.uid())
        )
    );

-- PHASE 3: Manager RLS on correction_tasks
-- Managers can view correction tasks linked to their departments
CREATE POLICY "manager_can_view_correction_tasks"
    ON public.correction_tasks FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT rctd.correction_task_id
            FROM public.rel__correction_task__department rctd
            WHERE rctd.department_id IN (
                SELECT mgr.department_id
                FROM public.rel__department__employee mgr
                JOIN public.employees e ON e.id = mgr.employee_id
                WHERE mgr.is_manager = true AND e.user_id = (SELECT auth.uid())
            )
        )
    );

-- Manager can view timeclock_corrections for tasks in their departments
CREATE POLICY "manager_can_view_timeclock_corrections"
    ON public.timeclock_corrections FOR SELECT TO authenticated
    USING (
        correction_task_id IN (
            SELECT rctd.correction_task_id
            FROM public.rel__correction_task__department rctd
            WHERE rctd.department_id IN (
                SELECT mgr.department_id
                FROM public.rel__department__employee mgr
                JOIN public.employees e ON e.id = mgr.employee_id
                WHERE mgr.is_manager = true AND e.user_id = (SELECT auth.uid())
            )
        )
    );

-- PHASE 4: Employee self-update policy on correction_tasks
-- Needed for cancel (employee sets status = 'cancelled' on own pending tasks)
CREATE POLICY "employee_can_update_own_correction_tasks"
    ON public.correction_tasks FOR UPDATE TO authenticated
    USING (
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

-- PHASE 5: approve_correction_task RPC
-- Server-side business logic for approval workflow.
-- Handles all 3 approval modes: hr_only, manager_only, both.
CREATE OR REPLACE FUNCTION public.approve_correction_task(
    p_correction_task_id TEXT,
    p_action TEXT
)
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
    v_all_depts_approved boolean;
    v_new_status text;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Fetch correction task
    SELECT * INTO v_task FROM public.correction_tasks WHERE id = p_correction_task_id;
    IF v_task IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Correction task not found');
    END IF;

    -- Fetch entity approval mode
    SELECT correction_approval_mode INTO v_entity
    FROM public.entities WHERE id = v_task.entity_id;

    -- Determine caller roles
    v_is_hr := public.is_admin_or_owner(v_task.organization_id);

    -- Check if caller is a manager for any linked department
    SELECT mgr.department_id INTO v_manager_dept_id
    FROM public.rel__correction_task__department rctd
    JOIN public.rel__department__employee mgr ON mgr.department_id = rctd.department_id
    JOIN public.employees e ON e.id = mgr.employee_id
    WHERE rctd.correction_task_id = p_correction_task_id
      AND mgr.is_manager = true
      AND e.user_id = v_caller_id
    LIMIT 1;

    v_is_manager := v_manager_dept_id IS NOT NULL;

    IF NOT v_is_hr AND NOT v_is_manager THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authorized to act on this correction');
    END IF;

    -- === REJECT ===
    IF p_action = 'reject' THEN
        IF v_task.status NOT IN ('pending', 'manager_approved') THEN
            RETURN jsonb_build_object('success', false, 'message', 'Cannot reject: status is ' || v_task.status);
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

        -- Approve for the manager's department(s)
        UPDATE public.rel__correction_task__department
        SET approved_by = v_caller_id, approved_at = now()
        WHERE correction_task_id = p_correction_task_id
          AND department_id IN (
              SELECT mgr.department_id
              FROM public.rel__department__employee mgr
              JOIN public.employees e ON e.id = mgr.employee_id
              WHERE mgr.is_manager = true AND e.user_id = v_caller_id
          )
          AND approved_by IS NULL;

        -- Check if all departments are approved
        SELECT NOT EXISTS (
            SELECT 1 FROM public.rel__correction_task__department
            WHERE correction_task_id = p_correction_task_id AND approved_by IS NULL
        ) INTO v_all_depts_approved;

        IF v_all_depts_approved THEN
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
            CASE WHEN v_all_depts_approved THEN 'All managers approved — correction approved'
                 ELSE 'Department approved — awaiting other managers' END);
    END IF;

    -- both mode
    IF v_entity.correction_approval_mode = 'both' THEN
        -- Manager approving
        IF v_is_manager AND v_task.status = 'pending' THEN
            UPDATE public.rel__correction_task__department
            SET approved_by = v_caller_id, approved_at = now()
            WHERE correction_task_id = p_correction_task_id
              AND department_id IN (
                  SELECT mgr.department_id
                  FROM public.rel__department__employee mgr
                  JOIN public.employees e ON e.id = mgr.employee_id
                  WHERE mgr.is_manager = true AND e.user_id = v_caller_id
              )
              AND approved_by IS NULL;

            SELECT NOT EXISTS (
                SELECT 1 FROM public.rel__correction_task__department
                WHERE correction_task_id = p_correction_task_id AND approved_by IS NULL
            ) INTO v_all_depts_approved;

            IF v_all_depts_approved THEN
                UPDATE public.correction_tasks
                SET status = 'manager_approved', updated_at = now()
                WHERE id = p_correction_task_id;
                v_new_status := 'manager_approved';
            ELSE
                UPDATE public.correction_tasks SET updated_at = now() WHERE id = p_correction_task_id;
                v_new_status := 'pending';
            END IF;

            RETURN jsonb_build_object('success', true, 'new_status', v_new_status, 'message',
                CASE WHEN v_all_depts_approved THEN 'All managers approved — awaiting HR'
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

        -- HR can also approve directly from pending if no departments linked (backward compat)
        IF v_is_hr AND v_task.status = 'pending' THEN
            SELECT NOT EXISTS (
                SELECT 1 FROM public.rel__correction_task__department
                WHERE correction_task_id = p_correction_task_id
            ) INTO v_all_depts_approved;

            IF v_all_depts_approved THEN
                UPDATE public.correction_tasks
                SET status = 'approved',
                    approved_by = v_caller_id,
                    approved_at = now(),
                    updated_at = now()
                WHERE id = p_correction_task_id;
                RETURN jsonb_build_object('success', true, 'new_status', 'approved', 'message', 'Correction approved (no departments linked)');
            END IF;
        END IF;

        RETURN jsonb_build_object('success', false, 'message',
            'Cannot approve: current status is ' || v_task.status || ', your role does not match the required next step');
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unknown approval mode');
END;
$$;
