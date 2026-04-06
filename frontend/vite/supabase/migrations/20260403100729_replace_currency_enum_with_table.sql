-- ============================================
-- Replace currency enum with global reference table
-- Not org-scoped — shared across all organizations
-- ============================================

-- Drop the enum
DROP TYPE IF EXISTS public.currencies_code_enum;

-- Create global reference table
CREATE TABLE public.currencies (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
);

-- RLS: any authenticated user can read, no write via API
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_can_view_currencies"
    ON public.currencies FOR SELECT
    TO authenticated
    USING (true);

-- Seed with common currencies (ISO 4217)
INSERT INTO public.currencies (code, display_name) VALUES
    ('USD', 'US Dollar'),
    ('EUR', 'Euro'),
    ('GBP', 'British Pound'),
    ('JPY', 'Japanese Yen'),
    ('CNY', 'Chinese Yuan'),
    ('VND', 'Vietnamese Dong'),
    ('KRW', 'South Korean Won'),
    ('SGD', 'Singapore Dollar'),
    ('THB', 'Thai Baht'),
    ('PHP', 'Philippine Peso'),
    ('INR', 'Indian Rupee'),
    ('MYR', 'Malaysian Ringgit'),
    ('IDR', 'Indonesian Rupiah'),
    ('TWD', 'New Taiwan Dollar'),
    ('HKD', 'Hong Kong Dollar'),
    ('AUD', 'Australian Dollar'),
    ('CAD', 'Canadian Dollar'),
    ('NZD', 'New Zealand Dollar'),
    ('CHF', 'Swiss Franc'),
    ('BRL', 'Brazilian Real');
