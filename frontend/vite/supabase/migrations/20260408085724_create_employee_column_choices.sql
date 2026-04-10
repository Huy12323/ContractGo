-- ============================================
-- EMPLOYEE COLUMN CHOICES — stable choice records for multi_select columns
-- ============================================

-- PHASE 1: CREATE TABLE
CREATE TABLE public.employee_column_choices (
    id TEXT PRIMARY KEY DEFAULT generate_id('ecc'),
    employee_column_id TEXT NOT NULL REFERENCES public.employee_columns(id) ON DELETE CASCADE,
    organization_id TEXT DEFAULT '' NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT generate_id('ecv'),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT employee_column_choices_unique_value UNIQUE (employee_column_id, value)
);

CREATE INDEX idx_employee_column_choices_employee_column_id ON public.employee_column_choices(employee_column_id);
CREATE INDEX idx_employee_column_choices_organization_id ON public.employee_column_choices(organization_id);

-- PHASE 2: TRIGGER (auto-populate organization_id from parent employee_columns)
CREATE OR REPLACE FUNCTION public.set_org_id_from_employee_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT organization_id INTO NEW.organization_id
    FROM public.employee_columns
    WHERE id = NEW.employee_column_id;

    IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'Cannot resolve organization_id for employee_column_id %', NEW.employee_column_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_org_id_employee_column_choices
    BEFORE INSERT ON public.employee_column_choices
    FOR EACH ROW
    EXECUTE FUNCTION public.set_org_id_from_employee_column();

-- PHASE 3: RLS
ALTER TABLE public.employee_column_choices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_employee_column_choices"
    ON public.employee_column_choices FOR SELECT
    TO authenticated
    USING (
        public.is_org_member(organization_id)
    );

CREATE POLICY "admin_or_owner_can_insert_employee_column_choices"
    ON public.employee_column_choices FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_admin_or_owner(organization_id)
    );

CREATE POLICY "admin_or_owner_can_update_employee_column_choices"
    ON public.employee_column_choices FOR UPDATE
    TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
    );

CREATE POLICY "admin_or_owner_can_delete_employee_column_choices"
    ON public.employee_column_choices FOR DELETE
    TO authenticated
    USING (
        public.is_admin_or_owner(organization_id)
    );

-- PHASE 4: MIGRATE EXISTING OPTIONS DATA
-- Convert employee_columns.options JSONB arrays → choice rows
INSERT INTO public.employee_column_choices (employee_column_id, label, value, sort_order)
SELECT
    ec.id,
    opt.label,
    generate_id('ecv'),
    opt.idx
FROM public.employee_columns ec,
    LATERAL jsonb_array_elements_text(ec.options) WITH ORDINALITY AS opt(label, idx)
WHERE ec.type = 'multi_select'
    AND ec.options IS NOT NULL
    AND jsonb_typeof(ec.options) = 'array';

-- PHASE 5: DROP OPTIONS COLUMN
ALTER TABLE public.employee_columns DROP COLUMN options;
