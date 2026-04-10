-- ============================================
-- ADD UNIVERSAL COLUMNS TO EMPLOYEES
-- ============================================

ALTER TABLE public.employees
    ADD COLUMN email TEXT NOT NULL DEFAULT '',
    ADD COLUMN first_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN last_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN birthday DATE NOT NULL DEFAULT '0001-01-01',
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
