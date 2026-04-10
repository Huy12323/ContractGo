-- ============================================
-- EMPLOYEE CONTRACTS — filled + signed contract instances
-- ============================================

-- PHASE 1: ENUM
CREATE TYPE public.employee_contracts_status_enum AS ENUM ('draft', 'signed', 'voided');

-- PHASE 2: CREATE TABLE
CREATE TABLE public.employee_contracts (
    id TEXT PRIMARY KEY DEFAULT generate_id('ect'),
    organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    onboarding_form_id TEXT REFERENCES public.onboarding_forms(id) ON DELETE SET NULL,
    form_snapshot JSONB NOT NULL DEFAULT '{}',
    field_values JSONB NOT NULL DEFAULT '{}',
    status public.employee_contracts_status_enum NOT NULL DEFAULT 'draft',
    signed_at TIMESTAMPTZ,
    signed_by TEXT,
    signer_ip TEXT,
    document_hash TEXT,
    signature_path TEXT,
    pdf_path TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_employee_contracts_organization_id ON public.employee_contracts(organization_id);
CREATE INDEX idx_employee_contracts_employee_id ON public.employee_contracts(employee_id);
CREATE INDEX idx_employee_contracts_onboarding_form_id ON public.employee_contracts(onboarding_form_id);
CREATE INDEX idx_employee_contracts_status ON public.employee_contracts(status);

-- PHASE 3: ENABLE RLS
ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/owner sees all org contracts, regular members see only their own
CREATE POLICY "admin_or_self_can_view_employee_contracts"
    ON public.employee_contracts FOR SELECT
    TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR
        employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "admin_or_owner_can_insert_employee_contracts"
    ON public.employee_contracts FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_employee_contracts"
    ON public.employee_contracts FOR UPDATE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_employee_contracts"
    ON public.employee_contracts FOR DELETE
    TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- PHASE 4: FORM DELETION TRIGGER
-- When an onboarding_form is deleted: delete draft contracts, preserve signed/voided (FK SET NULL handles onboarding_form_id → NULL)
CREATE OR REPLACE FUNCTION public.handle_form_deletion_contracts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.employee_contracts
    WHERE onboarding_form_id = OLD.id AND status = 'draft';

    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_handle_form_deletion_contracts
    BEFORE DELETE ON public.onboarding_forms
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_form_deletion_contracts();
