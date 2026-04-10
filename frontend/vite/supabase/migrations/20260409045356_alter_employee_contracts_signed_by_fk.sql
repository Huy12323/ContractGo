-- Change signed_by from TEXT to UUID FK → profiles
ALTER TABLE public.employee_contracts
    ALTER COLUMN signed_by TYPE UUID USING signed_by::uuid;

ALTER TABLE public.employee_contracts
    ADD CONSTRAINT employee_contracts_signed_by_fkey
    FOREIGN KEY (signed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_employee_contracts_signed_by ON public.employee_contracts(signed_by);
