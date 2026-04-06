-- ============================================
-- Replace currencies table with enum
-- Predefined currency codes (ISO 4217)
-- ============================================

-- Drop the currencies table (no data to preserve — just created)
DROP TABLE IF EXISTS public.currencies;

-- Create enum with common currencies for HR/payroll
CREATE TYPE public.currencies_code_enum AS ENUM (
    'USD', 'EUR', 'GBP', 'JPY', 'CNY',
    'VND', 'KRW', 'SGD', 'THB', 'PHP',
    'INR', 'MYR', 'IDR', 'TWD', 'HKD',
    'AUD', 'CAD', 'NZD', 'CHF', 'BRL'
);
