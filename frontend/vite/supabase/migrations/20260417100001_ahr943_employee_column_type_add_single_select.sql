-- ============================================
-- AHR-943 — add single_select to employee_column_type ENUM
-- Mirrors multi_select's storage (reuses employee_column_choices)
-- but renders as a single tag and uses single-value filter operators.
-- ============================================

ALTER TYPE employee_column_type ADD VALUE 'single_select';
