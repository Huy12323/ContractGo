-- ============================================
-- AHR-1946 — Employee audit log foundation
-- ============================================
-- Captures field-level changes (INSERT / UPDATE / DELETE) on employee records.
-- This T2 attaches the trigger to global public.employees only.
-- AHR-1947 (provisioning factory) attaches the perorg variant to each
-- org_<id>__employees_dynamic table at provisioning time.
--
-- Design notes:
--   - employee_id has NO FK on purpose: audit rows must outlive the employee
--     they describe. Org-level cascade (organization_id FK) is intentional and
--     GDPR-aligned.
--   - Generic JSONB diff is used so future column additions get audited
--     automatically. System columns are skipped via a hardcoded skip-list.
--   - Trigger-only writes; no client INSERT/UPDATE/DELETE policies.

-- PHASE 1: TABLE
CREATE TABLE public.employee_audit_log (
    id              TEXT PRIMARY KEY DEFAULT generate_id('eal'),
    employee_id     TEXT NOT NULL,
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    field_key       TEXT NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_audit_log_employee_changed_at
    ON public.employee_audit_log(employee_id, changed_at DESC);

CREATE INDEX idx_employee_audit_log_organization_id
    ON public.employee_audit_log(organization_id);

-- PHASE 2: RLS — admin_or_owner SELECT only; trigger-only writes
ALTER TABLE public.employee_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_owner_can_view_employee_audit_log"
    ON public.employee_audit_log FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- PHASE 3: HELPER — diff OLD vs NEW JSONB, emit one row per changed key
CREATE OR REPLACE FUNCTION public.audit_employee_diff(
    p_employee_id     TEXT,
    p_organization_id TEXT,
    p_old             JSONB,
    p_new             JSONB,
    p_skip_keys       TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    k TEXT;
BEGIN
    FOR k IN SELECT jsonb_object_keys(p_new) LOOP
        IF k = ANY(p_skip_keys) THEN
            CONTINUE;
        END IF;
        IF p_old -> k IS DISTINCT FROM p_new -> k THEN
            INSERT INTO public.employee_audit_log
                (employee_id, organization_id, actor_user_id, field_key, old_value, new_value)
            VALUES
                (p_employee_id, p_organization_id, auth.uid(), k, p_old -> k, p_new -> k);
        END IF;
    END LOOP;
END;
$$;

-- PHASE 4: TRIGGER FN — global public.employees (universal columns)
CREATE OR REPLACE FUNCTION public.audit_employees_global()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_skip_keys TEXT[] := ARRAY[
        'id', 'organization_id', 'user_id',
        'created_at', 'updated_at', '__full_name'
    ];
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.employee_audit_log
            (employee_id, organization_id, actor_user_id, field_key, old_value, new_value)
        VALUES
            (NEW.id, NEW.organization_id, auth.uid(), '__inserted', NULL, to_jsonb(NEW) - v_skip_keys);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.audit_employee_diff(
            OLD.id,
            OLD.organization_id,
            to_jsonb(OLD),
            to_jsonb(NEW),
            v_skip_keys
        );
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.employee_audit_log
            (employee_id, organization_id, actor_user_id, field_key, old_value, new_value)
        VALUES
            (OLD.id, OLD.organization_id, auth.uid(), '__deleted', to_jsonb(OLD) - v_skip_keys, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- PHASE 5: TRIGGER FN — per-org dynamic tables (col_* columns)
-- Ships unattached. AHR-1947 attaches it to each org_<id>__employees_dynamic
-- at provisioning time, passing the org id as TG_ARGV[0].
CREATE OR REPLACE FUNCTION public.audit_employees_perorg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_skip_keys      TEXT[] := ARRAY['employee_id'];
    v_organization_id TEXT  := TG_ARGV[0];
    v_employee_id    TEXT;
BEGIN
    IF v_organization_id IS NULL OR v_organization_id = '' THEN
        RAISE EXCEPTION 'audit_employees_perorg: missing TG_ARGV[0] (organization_id)';
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_employee_id := NEW.employee_id;
        INSERT INTO public.employee_audit_log
            (employee_id, organization_id, actor_user_id, field_key, old_value, new_value)
        VALUES
            (v_employee_id, v_organization_id, auth.uid(), '__inserted', NULL, to_jsonb(NEW) - v_skip_keys);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.audit_employee_diff(
            OLD.employee_id,
            v_organization_id,
            to_jsonb(OLD),
            to_jsonb(NEW),
            v_skip_keys
        );
    ELSIF TG_OP = 'DELETE' THEN
        v_employee_id := OLD.employee_id;
        INSERT INTO public.employee_audit_log
            (employee_id, organization_id, actor_user_id, field_key, old_value, new_value)
        VALUES
            (v_employee_id, v_organization_id, auth.uid(), '__deleted', to_jsonb(OLD) - v_skip_keys, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- PHASE 6: ATTACH trigger to global public.employees
CREATE TRIGGER trigger_audit_employees
    AFTER INSERT OR UPDATE OR DELETE ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_employees_global();
