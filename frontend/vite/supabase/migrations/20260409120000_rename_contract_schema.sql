-- ============================================
-- RENAME: onboarding_forms → contract_templates
-- RENAME: employee_contracts → contracts
-- UPDATE: status enum, add approval + prefill columns
-- ============================================

-- STEP 1: Rename onboarding_forms → contract_templates
ALTER TABLE public.onboarding_forms RENAME TO contract_templates;

ALTER TABLE public.contract_templates
    RENAME CONSTRAINT onboarding_forms_unique_name_per_org TO contract_templates_unique_name_per_org;

ALTER INDEX idx_onboarding_forms_organization_id RENAME TO idx_contract_templates_organization_id;

-- RLS policies (cannot rename — drop + recreate)
DROP POLICY "admin_or_owner_can_view_onboarding_forms" ON public.contract_templates;
DROP POLICY "admin_or_owner_can_insert_onboarding_forms" ON public.contract_templates;
DROP POLICY "admin_or_owner_can_update_onboarding_forms" ON public.contract_templates;
DROP POLICY "admin_or_owner_can_delete_onboarding_forms" ON public.contract_templates;

CREATE POLICY "admin_or_owner_can_view_contract_templates"
    ON public.contract_templates FOR SELECT TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_insert_contract_templates"
    ON public.contract_templates FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_contract_templates"
    ON public.contract_templates FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_contract_templates"
    ON public.contract_templates FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- STEP 2: Rename employee_contracts → contracts
ALTER TABLE public.employee_contracts RENAME TO contracts;
ALTER TABLE public.contracts RENAME COLUMN onboarding_form_id TO contract_template_id;

-- Rename indexes
ALTER INDEX idx_employee_contracts_organization_id RENAME TO idx_contracts_organization_id;
ALTER INDEX idx_employee_contracts_employee_id RENAME TO idx_contracts_employee_id;
ALTER INDEX idx_employee_contracts_onboarding_form_id RENAME TO idx_contracts_contract_template_id;
ALTER INDEX idx_employee_contracts_status RENAME TO idx_contracts_status;
ALTER INDEX idx_employee_contracts_signed_by RENAME TO idx_contracts_signed_by;

-- Rename explicit FK constraint
ALTER TABLE public.contracts
    RENAME CONSTRAINT employee_contracts_signed_by_fkey TO contracts_signed_by_fkey;

-- RLS policies
DROP POLICY "admin_or_self_can_view_employee_contracts" ON public.contracts;
DROP POLICY "admin_or_owner_can_insert_employee_contracts" ON public.contracts;
DROP POLICY "admin_or_owner_can_update_employee_contracts" ON public.contracts;
DROP POLICY "admin_or_owner_can_delete_employee_contracts" ON public.contracts;

CREATE POLICY "admin_or_self_can_view_contracts"
    ON public.contracts FOR SELECT TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
        OR employee_id IN (
            SELECT id FROM public.employees
            WHERE user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "admin_or_owner_can_insert_contracts"
    ON public.contracts FOR INSERT TO authenticated
    WITH CHECK (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_update_contracts"
    ON public.contracts FOR UPDATE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

CREATE POLICY "admin_or_owner_can_delete_contracts"
    ON public.contracts FOR DELETE TO authenticated
    USING (public.is_admin_or_owner(organization_id));

-- STEP 3: Replace status enum (draft/signed/voided → draft/sent/filled/active/voided)
CREATE TYPE public.contracts_status_enum AS ENUM ('draft', 'sent', 'filled', 'active', 'voided');

ALTER TABLE public.contracts
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE public.contracts_status_enum
        USING CASE
            WHEN status::text = 'signed' THEN 'active'::public.contracts_status_enum
            ELSE status::text::public.contracts_status_enum
        END,
    ALTER COLUMN status SET DEFAULT 'draft';

DROP TYPE public.employee_contracts_status_enum;

-- STEP 4: Add approval + prefill columns
ALTER TABLE public.contracts ADD COLUMN approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.contracts ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE public.contracts ADD COLUMN prefilled_fields JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_contracts_approved_by ON public.contracts(approved_by);

-- STEP 5: Update form deletion trigger
DROP TRIGGER trigger_handle_form_deletion_contracts ON public.contract_templates;
DROP FUNCTION public.handle_form_deletion_contracts();

CREATE OR REPLACE FUNCTION public.handle_template_deletion_contracts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.contracts
    WHERE contract_template_id = OLD.id AND status = 'draft';
    RETURN OLD;
END;
$$;

CREATE TRIGGER trigger_handle_template_deletion_contracts
    BEFORE DELETE ON public.contract_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_template_deletion_contracts();
